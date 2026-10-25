"""Persistent, user-scoped category identities, session assignments, and preferences."""

from contextlib import contextmanager
import json
import hashlib
from pathlib import Path
import re
import sqlite3
import time
from uuid import uuid4, uuid5, NAMESPACE_URL

STORE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "session_topics.sqlite3"


def normalized(value):
    return re.sub(r"[\W_]+", "", value.casefold())


class TopicStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else STORE_PATH

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS categories (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
                    description TEXT NOT NULL, parent_id TEXT, merged_into TEXT);
                CREATE TABLE IF NOT EXISTS category_aliases (
                    category_id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY(category_id, alias));
                CREATE TABLE IF NOT EXISTS topic_preferences (
                    user_id TEXT NOT NULL, category_id TEXT NOT NULL, PRIMARY KEY(user_id, category_id));
                CREATE TABLE IF NOT EXISTS permanent_prunes (
                    user_id TEXT NOT NULL, category_id TEXT NOT NULL, PRIMARY KEY(user_id, category_id));
                CREATE TABLE IF NOT EXISTS category_guards (
                    user_id TEXT NOT NULL, category_id TEXT NOT NULL, pruned_id TEXT NOT NULL,
                    PRIMARY KEY(user_id,category_id,pruned_id));
                CREATE TABLE IF NOT EXISTS category_semantic_checks (
                    user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
                    expires REAL NOT NULL, PRIMARY KEY(user_id,fingerprint));
                CREATE TABLE IF NOT EXISTS session_topics (
                    session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS session_topic_batches (
                    session_id TEXT NOT NULL, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    result TEXT NOT NULL, PRIMARY KEY(session_id,user_id,fingerprint));
                CREATE INDEX IF NOT EXISTS category_user_parent ON categories(user_id, parent_id);
                CREATE TABLE IF NOT EXISTS video_category_overrides (
                    user_id TEXT NOT NULL, video_id TEXT NOT NULL, category_id TEXT NOT NULL,
                    PRIMARY KEY(user_id, video_id));
                CREATE TABLE IF NOT EXISTS category_positions (
                    user_id TEXT NOT NULL, category_id TEXT NOT NULL, position INTEGER NOT NULL,
                    PRIMARY KEY(user_id, category_id));
            """)
            with connection:
                yield connection
        finally:
            connection.close()

    def _category(self, connection, user_id, category_id):
        seen = set()
        while category_id:
            if category_id in seen:
                raise ValueError("Cyclic category alias")
            seen.add(category_id)
            row = connection.execute("SELECT * FROM categories WHERE id = ? AND user_id = ?", (category_id, user_id)).fetchone()
            if row is None:
                raise ValueError("Unknown category for this user")
            if not row["merged_into"]:
                return dict(row)
            category_id = row["merged_into"]
        return None

    def _check_parent(self, connection, user_id, category_id, parent_id):
        seen = {category_id}
        depth = 0
        while parent_id:
            parent = self._category(connection, user_id, parent_id)
            if parent["id"] in seen or depth >= 7:
                raise ValueError("Category move would create a cycle or excessive depth")
            seen.add(parent["id"])
            parent_id = parent["parent_id"]
            depth += 1
        children = {}
        for row in connection.execute("SELECT id,parent_id FROM categories WHERE user_id=? AND merged_into IS NULL", (user_id,)):
            children.setdefault(row["parent_id"], []).append(row["id"])
        pending = [(category_id, 1)]
        visited = set()
        while pending:
            node_id, height = pending.pop()
            if node_id in visited or depth + height > 8:
                raise ValueError("Category move would create a cycle or excessive depth")
            visited.add(node_id)
            pending.extend((child, height + 1) for child in children.get(node_id, []))

    def permanent_ids(self, connection, user_id):
        hidden = {row[0] for row in connection.execute("SELECT category_id FROM permanent_prunes WHERE user_id=?", (user_id,))}
        categories = connection.execute("SELECT id,parent_id FROM categories WHERE user_id=?", (user_id,)).fetchall()
        guards = connection.execute("SELECT category_id,pruned_id FROM category_guards WHERE user_id=?", (user_id,)).fetchall()
        while True:
            expanded = hidden | {row[0] for row in categories if row[1] in hidden} | {row[0] for row in guards if row[1] in hidden}
            if expanded == hidden:
                return hidden
            hidden = expanded

    def permanently_prune(self, user_id, category_ids, expected_version):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = self.blacklist(user_id, connection=connection)
            if state["version"] != expected_version:
                raise ValueError("Topics changed. Refresh the compost bin and confirm again.")
            allowed = {item["id"] for root in state["topics"] for item in [root, *root["descendants"]] if not item["permanent"]}
            identities = set(category_ids)
            if not identities or not identities <= allowed:
                raise ValueError("Only topics currently in the compost bin can be permanently pruned.")
            for identity in identities:
                connection.execute("INSERT OR IGNORE INTO permanent_prunes VALUES (?,?)", (user_id, identity))
                # Permanent pruning remains a detection preference, even if its parent is restored later.
                connection.execute("INSERT OR IGNORE INTO topic_preferences VALUES (?,?)", (user_id, identity))
            return sorted(self.permanent_ids(connection, user_id))

    def blacklist(self, user_id, *, connection=None):
        """Canonical selected roots plus descendants; never infer ownership from a request."""
        if connection is None:
            with self.connection() as current:
                return self.blacklist(user_id, connection=current)
        categories = [dict(row) for row in connection.execute(
            "SELECT id,name,description,parent_id,merged_into FROM categories WHERE user_id=? ORDER BY id", (user_id,))]
        selected = sorted({self._category(connection, user_id, row[0])["id"] for row in connection.execute(
            "SELECT category_id FROM topic_preferences WHERE user_id=?", (user_id,))})
        aliases = [list(row) for row in connection.execute(
            "SELECT a.category_id,a.alias FROM category_aliases a JOIN categories c ON c.id=a.category_id WHERE c.user_id=? ORDER BY a.category_id,a.alias", (user_id,))]
        permanent = self.permanent_ids(connection, user_id)
        version = hashlib.sha256(json.dumps([categories, selected, aliases, sorted(permanent)], sort_keys=True).encode()).hexdigest()
        by_id = {row["id"]: row for row in categories if not row["merged_into"]}
        topics = []
        for identity in selected:
            root = by_id.get(identity)
            if not root:
                continue
            descendants = []
            for row in by_id.values():
                node, seen = row, set()
                while node and node["id"] not in seen:
                    if node["id"] == identity:
                        if row["id"] != identity:
                            descendants.append({**{key: row[key] for key in ("id", "name", "description", "parent_id")}, "permanent": row["id"] in permanent})
                        break
                    seen.add(node["id"])
                    node = by_id.get(node["parent_id"])
            ancestors, parent = [], by_id.get(root["parent_id"])
            while parent and parent["id"] not in {node["id"] for node in ancestors}:
                ancestors.append({key: parent[key] for key in ("id", "name", "description", "parent_id")})
                parent = by_id.get(parent["parent_id"])
            topics.append({"id": identity, "name": root["name"], "description": root["description"],
                           "parent_id": root["parent_id"], "permanent": identity in permanent,
                           "aliases": [alias for category, alias in aliases if category == identity],
                           "ancestors": ancestors, "descendants": descendants})
        return {"version": version, "topics": topics}

    def candidates(self, user_id, text="", limit=24):
        """Lexical retrieval bounds the catalog; the model matches meanings semantically."""
        words = set(re.findall(r"\w+", text.casefold()))
        with self.connection() as connection:
            rows = [dict(row) for row in connection.execute(
                "SELECT id, name, description, parent_id FROM categories WHERE user_id = ? AND merged_into IS NULL ORDER BY rowid DESC LIMIT 5000", (user_id,))]
            aliases = {}
            for item in connection.execute(
                "SELECT a.category_id,a.alias FROM category_aliases a JOIN categories c ON c.id=a.category_id WHERE c.user_id=? AND c.merged_into IS NULL", (user_id,)):
                values = aliases.setdefault(item[0], [])
                if len(values) < 4:
                    values.append(item[1])
            for row in rows:
                row["aliases"] = aliases.get(row["id"], [])
        rows.sort(key=lambda row: len(words & set(re.findall(r"\w+", " ".join(
            [row["name"], row["description"], *row["aliases"]]).casefold()))), reverse=True)
        by_id = {row["id"]: row for row in rows}
        result, size = [], 0
        included = set()
        for row in rows:
            # Supply the existing path along with a match so the model can reuse
            # a branch without inventing a duplicate parent or flattening it.
            path, current = [], row
            while current and current["id"] not in included:
                path.append(current)
                current = by_id.get(current["parent_id"])
            cost = sum(len(json.dumps(item, ensure_ascii=True)) for item in path)
            if len(result) + len(path) > limit or size + cost > 5000:
                continue
            result.extend(reversed(path))
            included.update(item["id"] for item in path)
            size += cost
        return result

    def apply_discovery(self, user_id, discovery):
        proposals = {node.key: node for node in discovery.topics}
        resolved = {}
        # Semantic checks precede writes. Fail closed for unresolved new meanings,
        # retaining a restorable record rather than deleting evidence.
        blacklist = self.blacklist(user_id)
        checks = {}
        covered_names = {}
        broader_names, broader_ids = set(), set()
        for topic in blacklist["topics"]:
            broader_names.update(normalized(node["name"]) for node in topic["ancestors"])
            broader_ids.update(node["id"] for node in topic["ancestors"])
            for covered in [topic, *topic["descendants"]]:
                covered_names[normalized(covered["name"])] = covered["id"]
            for alias in topic["aliases"]:
                covered_names[alias] = topic["id"]
        if blacklist["topics"]:
            from .pruned_detection import category_guard, Match
            for node in discovery.topics:
                if normalized(node.name) in covered_names or normalized(node.name) in broader_names or node.existing_category_id in broader_ids:
                    continue
                evidence = {"name": node.name, "description": node.description}
                signature = hashlib.sha256(json.dumps([evidence, blacklist["topics"]], sort_keys=True).encode()).hexdigest()
                with self.connection() as current:
                    cached = current.execute("SELECT result FROM category_semantic_checks WHERE user_id=? AND fingerprint=? AND expires>?", (user_id, signature, time.time())).fetchone()
                check = Match.model_validate_json(cached[0]) if cached else category_guard(evidence, blacklist["topics"])
                checks[node.key] = check
                if not cached:
                    with self.connection() as current:
                        current.execute("DELETE FROM category_semantic_checks WHERE expires<?", (time.time(),))
                        current.execute("INSERT OR REPLACE INTO category_semantic_checks VALUES (?,?,?,?)",
                            (user_id, signature, check.model_dump_json(), time.time() + (15 if check.status == "UNCERTAIN" else 86400)))
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current_blacklist = self.blacklist(user_id, connection=connection)
            def resolve(key):
                if key in resolved:
                    return resolved[key]
                proposal = proposals[key]
                parent_id = resolve(proposal.parent_key) if proposal.parent_key else None
                category = self._category(connection, user_id, proposal.existing_category_id) if proposal.existing_category_id else None
                if normalized(proposal.name) in covered_names and current_blacklist["version"] == blacklist["version"]:
                    category = self._category(connection, user_id, covered_names[normalized(proposal.name)])
                check = checks.get(key)
                if check and check.status == "MATCH" and check.confidence >= 0.85 and current_blacklist["version"] == blacklist["version"]:
                    # Suppress earlier equivalent records too, while preserving
                    # their history and identity for explicit restoration.
                    equivalents = connection.execute("SELECT id,name FROM categories WHERE user_id=? AND merged_into IS NULL", (user_id,)).fetchall()
                    for previous in equivalents:
                        if previous["id"] != check.matched_topic_id and (previous["id"] == proposal.existing_category_id or normalized(previous["name"]) == normalized(proposal.name)):
                            connection.execute("INSERT OR IGNORE INTO category_guards VALUES (?,?,?)", (user_id, previous["id"], check.matched_topic_id))
                    category = self._category(connection, user_id, check.matched_topic_id)
                if normalized(proposal.name) == "generalother":
                    category = self._category(connection, user_id, self._fallback_category(connection, user_id))
                    parent_id = category["parent_id"]
                # Discovery adds memberships and new branches; only manual edits
                # move existing branches or change inherited preferences.
                if category:
                    parent_id = category["parent_id"]
                if category is None:
                    matches = connection.execute("SELECT id FROM categories WHERE user_id = ? AND parent_id IS ? AND merged_into IS NULL", (user_id, parent_id)).fetchall()
                    for match in matches:
                        candidate = self._category(connection, user_id, match["id"])
                        aliases = {row[0] for row in connection.execute("SELECT alias FROM category_aliases WHERE category_id = ?", (candidate["id"],))}
                        if normalized(proposal.name) in aliases | {normalized(candidate["name"])}:
                            category = candidate
                            break
                existed = category is not None
                category_id = category["id"] if category else str(uuid4())
                self._check_parent(connection, user_id, category_id, parent_id)
                if category:
                    connection.execute("UPDATE categories SET parent_id = ? WHERE id = ?", (parent_id, category_id))
                else:
                    count = connection.execute("SELECT COUNT(*) FROM categories WHERE user_id = ?", (user_id,)).fetchone()[0]
                    if count >= 5000:
                        raise ValueError("Category catalog capacity reached")
                    connection.execute("INSERT INTO categories (id,user_id,name,description,parent_id) VALUES (?,?,?,?,?)",
                                       (category_id, user_id, proposal.name, proposal.description, parent_id))
                connection.execute("INSERT OR IGNORE INTO category_aliases VALUES (?,?)", (category_id, normalized(proposal.name)))
                if check and check.status != "UNCERTAIN" and check.confidence >= 0.85:
                    connection.execute("DELETE FROM category_guards WHERE user_id=? AND category_id=?", (user_id, category_id))
                unresolved = not existed and ((check and (check.status == "UNCERTAIN" or check.confidence < 0.85)) or current_blacklist["version"] != blacklist["version"])
                if unresolved:
                    connection.executemany("INSERT OR IGNORE INTO category_guards VALUES (?,?,?)",
                        [(user_id, category_id, topic["id"]) for topic in current_blacklist["topics"]])
                resolved[key] = category_id
                return category_id

            assignments = {}
            for node in discovery.topics:
                category_id = resolve(node.key)
                for video_id in node.video_ids:
                    assignments.setdefault(video_id, set()).add(category_id)
        return {video_id: sorted(ids) for video_id, ids in assignments.items()}

    def fallback_category(self, user_id):
        """A stable catch-all guarantees coverage without guessing a subject."""
        with self.connection() as connection:
            return self._fallback_category(connection, user_id)

    def _fallback_category(self, connection, user_id):
        category_id = str(uuid5(NAMESPACE_URL, f"gatorhacks26:general-other:{user_id}"))
        connection.execute(
            "INSERT OR IGNORE INTO categories (id,user_id,name,description,parent_id) VALUES (?,?,?,?,NULL)",
            (category_id, user_id, "General / Other",
             "Videos without a reliably established topic, including insufficient metadata or unavailable model classification."))
        return self._category(connection, user_id, category_id)["id"]

    def save_session(self, session_id, user_id, result):
        with self.connection() as connection:
            owner = connection.execute("SELECT user_id FROM session_topics WHERE session_id=?", (session_id,)).fetchone()
            if owner and owner[0] != user_id:
                raise ValueError("Session belongs to another user")
            connection.execute("INSERT INTO session_topics VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET result=excluded.result WHERE user_id=excluded.user_id",
                               (session_id, user_id, json.dumps(result, ensure_ascii=True)))

    def has_session(self, session_id, user_id):
        with self.connection() as connection:
            return connection.execute("SELECT 1 FROM session_topics WHERE session_id=? AND user_id=?", (session_id, user_id)).fetchone() is not None

    def reset_tree(self, user_id, *, connection=None):
        """Clear category history while retaining individual session analyses."""
        if connection is None:
            with self.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                return self.reset_tree(user_id, connection=connection)
        connection.execute("DELETE FROM category_aliases WHERE category_id IN (SELECT id FROM categories WHERE user_id=?)", (user_id,))
        connection.execute("DELETE FROM topic_preferences WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM permanent_prunes WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM category_guards WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM category_semantic_checks WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM video_category_overrides WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM category_positions WHERE user_id=?", (user_id,))
        connection.execute("DELETE FROM session_topic_batches WHERE user_id=?", (user_id,))
        for row in connection.execute("SELECT session_id,result FROM session_topics WHERE user_id=?", (user_id,)).fetchall():
            result = json.loads(row["result"])
            result.update(assignments={}, fallback_video_ids=[], unclassified_video_ids=[], tree_reset=True)
            connection.execute("UPDATE session_topics SET result=? WHERE session_id=? AND user_id=?",
                               (json.dumps(result), row["session_id"], user_id))
        connection.execute("DELETE FROM categories WHERE user_id=?", (user_id,))

    def cached_batch(self, session_id, user_id, fingerprint):
        with self.connection() as connection:
            row = connection.execute("SELECT result FROM session_topic_batches WHERE session_id=? AND user_id=? AND fingerprint=?", (session_id, user_id, fingerprint)).fetchone()
            return json.loads(row[0]) if row else None

    def save_batch(self, session_id, user_id, fingerprint, result):
        with self.connection() as connection:
            connection.execute("INSERT OR REPLACE INTO session_topic_batches VALUES (?,?,?,?)",
                               (session_id, user_id, fingerprint, json.dumps(result)))

    def set_preference(self, user_id, category_id, reduce):
        with self.connection() as connection:
            category = self._category(connection, user_id, category_id)
            if category["id"] in self.permanent_ids(connection, user_id):
                raise ValueError("Permanently pruned topics cannot be restored or changed.")
            if reduce:
                connection.execute("INSERT OR IGNORE INTO topic_preferences VALUES (?,?)", (user_id, category["id"]))
            else:
                for row in connection.execute("SELECT category_id FROM topic_preferences WHERE user_id=?", (user_id,)).fetchall():
                    if self._category(connection, user_id, row[0])["id"] == category["id"]:
                        connection.execute("DELETE FROM topic_preferences WHERE user_id=? AND category_id=?", (user_id, row[0]))

    def move_video(self, user_id, video_id, category_id):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            category = self._category(connection, user_id, category_id)
            if category["id"] in self.permanent_ids(connection, user_id):
                raise ValueError("Cannot move videos into a permanently pruned topic.")
            reviews = [json.loads(row[0]) for row in connection.execute("SELECT result FROM session_topics WHERE user_id=?", (user_id,))]
            if not any(video_id in review.get("assignments", {}) or any(video.get("video_id") == video_id for video in review.get("videos", [])) for review in reviews):
                raise ValueError("Unknown video for this user")
            connection.execute("INSERT INTO video_category_overrides VALUES (?,?,?) ON CONFLICT(user_id,video_id) DO UPDATE SET category_id=excluded.category_id",
                               (user_id, video_id, category["id"]))

    def edit_category(self, user_id, category_id, *, name=None, parent_id=None, move=False, merge_into=None, before_id=None, after_id=None):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            category = self._category(connection, user_id, category_id)
            category_id = category["id"]
            hidden = self.permanent_ids(connection, user_id)
            if category_id in hidden or parent_id in hidden or merge_into in hidden:
                raise ValueError("Permanently pruned topics cannot be changed.")
            if merge_into:
                target = self._category(connection, user_id, merge_into)
                if target["id"] in hidden:
                    raise ValueError("Permanently pruned topics cannot be changed.")
                if target["id"] == category_id:
                    return
                self._check_parent(connection, user_id, category_id, target["id"])
                connection.execute("UPDATE categories SET parent_id=? WHERE parent_id=?", (target["id"], category_id))
                connection.execute("UPDATE categories SET merged_into=? WHERE id=?", (target["id"], category_id))
                connection.execute("INSERT OR IGNORE INTO category_aliases SELECT ?, alias FROM category_aliases WHERE category_id=?", (target["id"], category_id))
            else:
                if name:
                    connection.execute("INSERT OR IGNORE INTO category_aliases VALUES (?,?)", (category_id, normalized(category["name"])))
                    connection.execute("UPDATE categories SET name=? WHERE id=?", (name, category_id))
                if move:
                    if parent_id:
                        parent_id = self._category(connection, user_id, parent_id)["id"]
                        if parent_id in hidden:
                            raise ValueError("Permanently pruned topics cannot be changed.")
                    self._check_parent(connection, user_id, category_id, parent_id)
                    if before_id and after_id:
                        raise ValueError("Choose one ordering target")
                    anchor = self._category(connection, user_id, before_id or after_id) if before_id or after_id else None
                    if anchor and (anchor["id"] == category_id or anchor["parent_id"] != parent_id):
                        raise ValueError("Ordering target must be another child of the destination parent")
                    connection.execute("UPDATE categories SET parent_id=? WHERE id=?", (parent_id, category_id))
                    positions = {row[0]: row[1] for row in connection.execute("SELECT category_id,position FROM category_positions WHERE user_id=?", (user_id,))}
                    siblings = [dict(row) for row in connection.execute("SELECT id,name FROM categories WHERE user_id=? AND parent_id IS ? AND merged_into IS NULL AND id<>?", (user_id, parent_id, category_id))]
                    siblings.sort(key=lambda item: (positions.get(item["id"], 1000000), item["name"].casefold()))
                    identities = [item["id"] for item in siblings]
                    index = identities.index(anchor["id"]) + bool(after_id) if anchor else len(identities)
                    identities.insert(index, category_id)
                    connection.executemany("INSERT OR REPLACE INTO category_positions VALUES (?,?,?)",
                                           [(user_id, identity, index) for index, identity in enumerate(identities)])

    def view(self, session_id, user_id):
        with self.connection() as connection:
            row = connection.execute("SELECT result FROM session_topics WHERE session_id=? AND user_id=?", (session_id, user_id)).fetchone()
            if row is None:
                owner = connection.execute("SELECT user_id FROM session_topics WHERE session_id=?", (session_id,)).fetchone()
                if owner:
                    return None
            history = [json.loads(item[0]) for item in connection.execute(
                "SELECT result FROM session_topics WHERE user_id=? ORDER BY rowid", (user_id,))]
            if row is None and not history:
                return None
            result = json.loads(row[0]) if row else {"session_id": session_id, "status": "pending",
                "assignments": {}, "videos": [], "errors": [], "fallback_used": False}
            # The latest completed classification of a repeated video replaces
            # its old membership. Read historical reviews too, without migration.
            history.sort(key=lambda item: item.get("completed_at", ""))
            global_assignments, global_videos = {}, {}
            for review in history:
                global_assignments.update(review.get("assignments", {}))
                global_videos.update({video["video_id"]: video for video in review.get("videos", [])})
            overrides = {row[0]: row[1] for row in connection.execute("SELECT video_id,category_id FROM video_category_overrides WHERE user_id=?", (user_id,))}
            global_assignments.update({video_id: [category_id] for video_id, category_id in overrides.items()})
            positions = {row[0]: row[1] for row in connection.execute("SELECT category_id,position FROM category_positions WHERE user_id=?", (user_id,))}
            def category_order(node):
                return positions.get(node["id"], 1000000), node["name"].casefold()
            preferences = {self._category(connection, user_id, item[0])["id"] for item in connection.execute(
                "SELECT category_id FROM topic_preferences WHERE user_id=?", (user_id,))}
            guarded = {self._category(connection, user_id, item[0])["id"] for item in connection.execute(
                "SELECT category_id,pruned_id FROM category_guards WHERE user_id=?", (user_id,))
                if self._category(connection, user_id, item[1])["id"] in preferences}
            hidden = self.permanent_ids(connection, user_id)
            nodes = {item["id"]: {"id": item["id"], "name": item["name"],
                "description": item["description"], "parent_id": item["parent_id"], "video_ids": set(), "children": []}
                for item in connection.execute("SELECT * FROM categories WHERE user_id=? AND merged_into IS NULL", (user_id,)) if item["id"] not in hidden}
            assignments = {}
            for video_id, category_ids in global_assignments.items():
                assignments[video_id] = set()
                for category_id in category_ids:
                    category = self._category(connection, user_id, category_id)
                    if category["id"] in hidden:
                        continue
                    assignments[video_id].add(category["id"])
                    seen = set()
                    while category:
                        if category["id"] in seen:
                            raise ValueError("Cyclic category hierarchy")
                        seen.add(category["id"])
                        node = nodes.setdefault(category["id"], {"id": category["id"], "name": category["name"],
                            "description": category["description"], "parent_id": category["parent_id"], "video_ids": set(), "children": []})
                        node["video_ids"].add(video_id)
                        category = self._category(connection, user_id, category["parent_id"]) if category["parent_id"] else None
            roots = []
            for node in nodes.values():
                node["video_ids"] = sorted(node["video_ids"])
                node["video_count"] = len(node["video_ids"])
                node["selected"] = node["id"] in preferences
                parent = nodes.get(node["parent_id"])
                (parent["children"] if parent else roots).append(node)

            def inherited(node, reduced=False):
                node["inherited"] = reduced
                node["reduce"] = reduced or node["selected"] or node["id"] in guarded
                node["children"].sort(key=category_order)
                for child in node["children"]:
                    inherited(child, node["reduce"])

            for root in roots:
                inherited(root)
            result["tree"] = sorted(roots, key=category_order)
            result["tree_scope"] = "global"
            assignments = {video_id: ids for video_id, ids in assignments.items() if ids}
            result["tree_assignments"] = {video_id: sorted(ids) for video_id, ids in assignments.items()}
            result["tree_videos"] = [video for video_id, video in global_videos.items() if video_id in assignments]
            result["global_video_count"] = len(assignments)
            result["assignments"] = {video_id: sorted({self._category(connection, user_id, category_id)["id"]
                for category_id in category_ids} - hidden) for video_id, category_ids in result.get("assignments", {}).items()}
            result["selected_category_ids"] = sorted(preferences)
            result["blacklist_version"] = self.blacklist(user_id, connection=connection)["version"]
            for video in result.get("videos", []):
                if video["video_id"] in overrides and overrides[video["video_id"]] not in hidden:
                    result["assignments"][video["video_id"]] = [self._category(connection, user_id, overrides[video["video_id"]])["id"]]
            result["reduce_video_ids"] = sorted({video_id for node in nodes.values() if node["reduce"] for video_id in node["video_ids"]})
            return result

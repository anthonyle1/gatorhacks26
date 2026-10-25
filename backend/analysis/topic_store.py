"""Persistent, user-scoped category identities, session assignments, and preferences."""

from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
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
                CREATE TABLE IF NOT EXISTS session_topics (
                    session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS session_topic_batches (
                    session_id TEXT NOT NULL, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    result TEXT NOT NULL, PRIMARY KEY(session_id,user_id,fingerprint));
                CREATE INDEX IF NOT EXISTS category_user_parent ON categories(user_id, parent_id);
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
        with self.connection() as connection:
            def resolve(key):
                if key in resolved:
                    return resolved[key]
                proposal = proposals[key]
                parent_id = resolve(proposal.parent_key) if proposal.parent_key else None
                category = self._category(connection, user_id, proposal.existing_category_id) if proposal.existing_category_id else None
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
            if reduce:
                connection.execute("INSERT OR IGNORE INTO topic_preferences VALUES (?,?)", (user_id, category["id"]))
            else:
                for row in connection.execute("SELECT category_id FROM topic_preferences WHERE user_id=?", (user_id,)).fetchall():
                    if self._category(connection, user_id, row[0])["id"] == category["id"]:
                        connection.execute("DELETE FROM topic_preferences WHERE user_id=? AND category_id=?", (user_id, row[0]))

    def edit_category(self, user_id, category_id, *, name=None, parent_id=None, move=False, merge_into=None):
        with self.connection() as connection:
            category = self._category(connection, user_id, category_id)
            category_id = category["id"]
            if merge_into:
                target = self._category(connection, user_id, merge_into)
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
                    self._check_parent(connection, user_id, category_id, parent_id)
                    connection.execute("UPDATE categories SET parent_id=? WHERE id=?", (parent_id, category_id))

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
            preferences = {self._category(connection, user_id, item[0])["id"] for item in connection.execute(
                "SELECT category_id FROM topic_preferences WHERE user_id=?", (user_id,))}
            nodes = {item["id"]: {"id": item["id"], "name": item["name"],
                "description": item["description"], "parent_id": item["parent_id"], "video_ids": set(), "children": []}
                for item in connection.execute("SELECT * FROM categories WHERE user_id=? AND merged_into IS NULL", (user_id,))}
            assignments = {}
            for video_id, category_ids in global_assignments.items():
                assignments[video_id] = set()
                for category_id in category_ids:
                    category = self._category(connection, user_id, category_id)
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
                node["reduce"] = reduced or node["selected"]
                node["children"].sort(key=lambda child: child["name"].casefold())
                for child in node["children"]:
                    inherited(child, node["reduce"])

            for root in roots:
                inherited(root)
            result["tree"] = sorted(roots, key=lambda node: node["name"].casefold())
            result["tree_scope"] = "global"
            result["tree_assignments"] = {video_id: sorted(ids) for video_id, ids in assignments.items()}
            result["tree_videos"] = [video for video_id, video in global_videos.items() if video_id in assignments]
            result["global_video_count"] = len(assignments)
            result["assignments"] = {video_id: sorted({self._category(connection, user_id, category_id)["id"]
                for category_id in category_ids}) for video_id, category_ids in result.get("assignments", {}).items()}
            result["selected_category_ids"] = sorted(preferences)
            result["reduce_video_ids"] = sorted({video_id for node in nodes.values() if node["reduce"] for video_id in node["video_ids"]})
            return result

/* Compost-only hierarchy and Lucide paths (ISC; see vendor/LUCIDE-LICENSE). */
(() => {
  const paths = {
    restore: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11'],
    flame: ['M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4'],
    branch: ['M15 6a9 9 0 0 0-9 9V3'],
    trash: ['M10 11v6', 'M14 11v6', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, String(value));
    for (const d of paths[name] || []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); svg.appendChild(path);
    }
    if (name === 'branch') for (const [cx, cy] of [[18, 6], [6, 18]]) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', 3); svg.appendChild(circle);
    }
    return svg;
  }

  function hierarchy(topics) {
    const nodes = new Map(), coverage = new Map();
    const hidden = new Set(topics.flatMap(root => [root, ...(root.descendants || [])]).filter(node => node.permanent).map(node => node.id));
    const add = (topic, parent) => {
      if (hidden.has(topic.id)) return;
      const previous = nodes.get(topic.id);
      nodes.set(topic.id, { ...previous, ...topic, parent_id: topic.parent_id ?? parent ?? previous?.parent_id ?? null, children: [] });
    };
    const selected = topics.filter(root => !root.permanent);
    for (const root of selected) {
      const ancestors = root.ancestors || [];
      ancestors.forEach((ancestor, index) => add(ancestor, ancestors[index + 1]?.id));
      add(root, ancestors[0]?.id);
      for (const topic of [root, ...(root.descendants || [])]) {
        if (hidden.has(topic.id)) continue;
        if (topic.id !== root.id) add(topic, root.id);
        if (!coverage.has(topic.id)) coverage.set(topic.id, []);
        coverage.get(topic.id).push(root);
      }
    }
    const roots = [];
    for (const node of nodes.values()) {
      node.coverage = coverage.get(node.id) || [];
      const parent = nodes.get(node.parent_id);
      if (parent && parent !== node) parent.children.push(node); else roots.push(node);
    }
    const sort = branch => branch.sort((a, b) => a.name.localeCompare(b.name)).forEach(node => sort(node.children));
    sort(roots);
    return { roots, selected, count: coverage.size, nodes };
  }
  globalThis.PruneCompost = { hierarchy, icon };
})();

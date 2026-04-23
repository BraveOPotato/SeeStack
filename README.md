# SeeStack

**An interactive call stack and data flow visualizer built with plain HTML, CSS, and JavaScript — no build tools, no dependencies.**

SeeStack lets you diagram function relationships, conditional branching, and data flow as a live, draggable graph. Everything runs in the browser and saves automatically to `localStorage`.

![SeeStack screenshot](screenshot.png)

---

## Features

### Node Types
| Type | Shape | Purpose |
|------|-------|---------|
| **Function** | Circle | Represents a named function with optional parameters and return type |
| **Conditional** | Diamond | Represents `if`/branching logic with named output branches |

### Edges
| Type | Style | Auto-assigned when… |
|------|-------|----------------------|
| **Call** | Curved teal | Connecting any two nodes (default); cond → fn |
| **Return** | Straight dashed orange | Function has a return type and is called by another function |
| **Condition** | Curved yellow | fn → cond |
| **Param Source** | Curved purple | Manually assigned; marks a data source for a parameter |

Each edge stores a **data type**, **example value**, and an optional **label**. Hover an edge to see its metadata in a tooltip.

### Zones
Semi-transparent named rectangles you can draw behind nodes to visually group related functions by concern (e.g. "Auth", "Data Layer", "UI"). Zones are drag-to-create, resizable, color-customizable, and fully persisted.

### Auto-scaling Nodes
Child function nodes (called by another function via a `call` edge) are automatically rendered at **75% the size** of their nearest ancestor. This gives an immediate visual hierarchy showing call depth. You can override any node's size manually via the Size Override slider in the edit modal.

### Search
Press `Ctrl+F` (or click the search bar) to search across node names, parameter names/types, return types, and notes. Matching nodes are highlighted with a gold ring. Press `Enter` to cycle through matches.

### Persistence
- **Auto-saves** to `localStorage` on every change — your diagram is always there when you come back.
- **Export** as SVG via the toolbar.
- **Save/Load** as a `.seestack.json` file for sharing or version control.
- Pan position and zoom level are saved and restored.

---

## Getting Started

SeeStack is a static site — no build step required.

```bash
git clone https://github.com/your-username/seestack
cd seestack

# Any static file server works:
npx serve .
# or
python3 -m http.server
# or just open index.html in a browser (some features need a server for PWA/SW)
```

Then open `http://localhost:3000` (or whichever port your server uses).

---

## Usage

### Tools & Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select / Move tool |
| `F` | Place a Function node (click canvas to drop) |
| `C` | Place a Conditional node |
| `E` | Connect tool — drag from a port dot to another node |
| `Z` | Zone tool — drag to draw a zone rectangle |
| `Del` / `Backspace` | Delete selected node(s), edge, or zone |
| `Escape` | Clear selection, close modals, clear search |
| `Ctrl+A` | Select all nodes |
| `Ctrl+Z` | Undo |
| `Ctrl+S` | Save to file |
| `Ctrl+F` | Focus search |
| `Scroll` | Zoom in/out (centered on cursor) |
| `Alt+Drag` / `Middle-click drag` | Pan canvas |

### Creating Nodes
1. Press `F` for a Function node or `C` for a Conditional, then click anywhere on the canvas.
2. A modal appears to name the node, define parameters (name / type / example value), set a return type, pick a color, and override the size.
3. Double-click any existing node to re-open its edit modal.

### Connecting Nodes
1. Press `E` to switch to Connect mode, then drag from any **port dot** (the small circles around a node's edge) to another node.
2. A modal appears to set edge type, data type, example, label, and color.
3. Alternatively: in Connect mode, drag directly from node body to node body.

**Auto-type rules:**
- Dragging from a **function → conditional** creates a `cond` edge automatically.
- Dragging from a **conditional → function** creates a `call` edge automatically.
- Setting a **return type** on a function automatically creates a `return` edge back to any known callers.

### Zones
1. Press `Z` (or click the Zone button in the toolbar).
2. Drag on the canvas to draw the zone rectangle. Release to open the label/color editor.
3. Drag a zone by its interior to reposition it.
4. Drag the **bottom-right corner handle** to resize it.
5. Double-click a zone to edit its label or color.
6. Right-click a zone for Edit / Delete options.

---

## File Format

SeeStack diagrams are plain JSON with a `.seestack.json` extension:

```json
{
  "version": 3,
  "nodes": [
    {
      "id": "n1",
      "type": "fn",
      "x": 220, "y": 250,
      "name": "main",
      "params": [{ "name": "args", "type": "string[]", "example": "[\"--verbose\"]" }],
      "returnType": "void",
      "returnExample": "",
      "color": "",
      "notes": "Entry point",
      "sizeOverride": null
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "n1", "to": "n2",
      "type": "call",
      "dtype": "string",
      "example": "\"https://api.example.com\"",
      "label": "",
      "color": ""
    }
  ],
  "zones": [
    {
      "id": "z1",
      "x": 130, "y": 60, "w": 260, "h": 460,
      "label": "Core",
      "fill": "rgba(77,232,178,0.06)",
      "border": "rgba(77,232,178,0.25)"
    }
  ],
  "nextId": 100,
  "pan": { "x": 0, "y": 0 },
  "zoom": 1
}
```

---

## PWA Support

SeeStack ships with a `manifest.json` and `sw.js` service worker. When served over HTTPS it can be installed as a Progressive Web App from the browser's address bar. Once installed, it works fully offline — all assets are cached on first load.

---

## Browser Support

Works in any modern browser (Chrome, Firefox, Safari, Edge). Requires no JavaScript frameworks, no npm, and no transpilation. The only external resources are two Google Fonts loaded at runtime; the app is fully functional without them.

---

## Project Structure

```
seestack/
├── index.html      # Single-page app shell + all modals
├── app.js          # All application logic (~950 lines, vanilla JS)
├── style.css       # All styles (~300 lines, CSS variables + dark theme)
├── manifest.json   # PWA manifest
├── sw.js           # Service worker for offline caching
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## License

MIT — do whatever you want with it.

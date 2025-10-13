# GraphFS

A graph-based folder explorer for AI-driven development. Visualize your project structure, select multiple files, and copy them in bulk with formatted context perfect for AI assistants.

![GraphFS Interface](images/image1.png)
![GraphFS Interface](images/image2.png)

---

## Why GraphFS?

Working with AI code assistants? GraphFS makes it easy to share code context:

- **Visualize** your project as an interactive force-directed graph
- **Select** multiple files with click or lasso selection  
- **Reorder** files via drag-and-drop
- **Copy** all selected files with numbered formatting for AI prompts
- **Monitor** real-time file changes with automatic updates

---

## Features

- **Multi-root support** - Explore multiple projects simultaneously
- **Traditional tree overlay** - Classic folder view alongside the graph
- **Smart selection** - Click files or lasso-select groups
- **Drag-and-drop ordering** - Control script sequence
- **Live file watching** - Auto-updates when files change
- **Favorites system** - Bookmark frequently-used directories
- **Dark/light themes**
- **Client-side filtering** - Exclude `venv`, `node_modules`, etc.

---

## Platform Support

✅ **Linux** (native inotify)  
✅ **macOS** (FSEvents)  
✅ **Windows** (native API)

Cross-platform filesystem watching automatically selects the best backend for your OS.

---

## Getting Started

### Requirements

- **Python 3.14+** (recommended for async/ASGI features)
- pip

### Installation
```bash
git clone https://github.com/aaricantto/GraphFS.git
cd graphfs
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py
```
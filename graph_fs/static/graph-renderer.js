// graph-renderer.js - D3 rendering and simulation engine

export class GraphRenderer {
    constructor() {
        this.svg = null;
        this.simulation = null;
        this.graphW = 0;
        this.graphH = 0;
        this.graphContainerEl = null;
        this.resizeObserver = null;
        this.animationFrameId = null;

        this.nodeSelection = null;
        this.linkSelection = null;
        this.labelSelection = null;

        this.nodeStrokeColor = '#ffffff';
        this.linkStrokeColor = '#999999';
        this.selectedNodeColor = '#000000';

        this.lasso = null;
        this.lassoStartPoint = null;

        this.onNodeClick = null;
        this.onLassoSelect = null;
    }

    initialize(containerEl, onNodeClick, onLassoSelect) {
        console.log('GraphRenderer: initialize');
        this.graphContainerEl = containerEl;
        this.onNodeClick = onNodeClick;
        this.onLassoSelect = onLassoSelect;

        this.measureGraph();
        this.createSvg();
        this.createSimulation();
        this.setupEventListeners();
        this.setupResizeObserver();
    }

    measureGraph() {
        const r = this.graphContainerEl.getBoundingClientRect();
        this.graphW = Math.max(100, Math.floor(r.width));
        this.graphH = Math.max(100, Math.floor(r.height));
    }

    createSvg() {
        this.svg = d3.select(this.graphContainerEl)
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${this.graphW} ${this.graphH}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('font', '12px sans-serif');

        this.svg.append('rect')
            .attr('class', 'graph-bg')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.graphW)
            .attr('height', this.graphH)
            .attr('fill', 'none')
            .attr('pointer-events', 'all');
    }

    createSimulation() {
        this.simulation = d3.forceSimulation([])
            .force('link', d3.forceLink([]).id(d => d.id).distance(50).strength(1))
            .force('charge', d3.forceManyBody().strength(-2000))
            .force('collide', d3.forceCollide(50))
            .force('x', d3.forceX(this.graphW / 2))
            .force('y', d3.forceY(this.graphH / 2))
            .on('tick', () => this.throttledTick());
    }

    setupEventListeners() {
        const svgNode = this.svg.node();
        svgNode.addEventListener('mousedown', (e) => this.lassoStart(e), { passive: false });
        svgNode.addEventListener('mousemove', (e) => this.lassoDraw(e), { passive: true });
        svgNode.addEventListener('mouseup', (e) => this.lassoEnd(e), { passive: true });
        svgNode.addEventListener('mouseleave', (e) => this.lassoCancel(e), { passive: true });
    }

    setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(() => this.handleResize());
        this.resizeObserver.observe(this.graphContainerEl);
    }

    handleResize() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = requestAnimationFrame(() => {
            this.measureGraph();
            this.applySvgSize();
            this.animationFrameId = null;
        });
    }

    applySvgSize() {
        this.svg.attr('viewBox', `0 0 ${this.graphW} ${this.graphH}`);
        this.svg.select('rect.graph-bg').attr('width', this.graphW).attr('height', this.graphH);
        this.simulation.force('x', d3.forceX(this.graphW / 2)).force('y', d3.forceY(this.graphH / 2));
        this.simulation.alpha(0.3).restart();
    }

    updateColorVariables(theme) {
        if (theme === 'dark') {
            this.nodeStrokeColor = '#1a1a1a';
            this.linkStrokeColor = '#ffffff';
            this.selectedNodeColor = '#ffffff';
        } else {
            this.nodeStrokeColor = '#ffffff';
            this.linkStrokeColor = '#999999';
            this.selectedNodeColor = '#000000';
        }
    }

    updateGraph(nodesData, linksData) {
        console.log('GraphRenderer: updateGraph');

        this.linkSelection = this.svg.selectAll('line.link')
            .data(linksData, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
        this.linkSelection.exit().remove();
        this.linkSelection = this.linkSelection.enter().append('line').classed('link', true)
            .attr('stroke-opacity', 0.6).attr('stroke-width', 1).lower().merge(this.linkSelection);

        this.nodeSelection = this.svg.selectAll('circle.node').data(nodesData, d => d.id);
        this.nodeSelection.exit().remove();
        const nodeEnter = this.nodeSelection.enter().append('circle').classed('node', true).attr('r', 10)
            .style('stroke', this.nodeStrokeColor).style('stroke-width', 1)
            .call(this.createDragHandler())
            .on('click', (event, d) => { event.stopPropagation(); if (this.onNodeClick) this.onNodeClick(d); });
        this.nodeSelection = nodeEnter.merge(this.nodeSelection);

        this.labelSelection = this.svg.selectAll('text.label').data(nodesData, d => d.id);
        this.labelSelection.exit().remove();
        const labelEnter = this.labelSelection.enter().append('text').classed('label', true)
            .attr('x', 15).attr('y', 5).text(d => d.nodeName)
            .style('user-select', 'none').style('pointer-events', 'none').style('paint-order', 'stroke')
            .style('stroke', this.nodeStrokeColor).style('fill', this.selectedNodeColor).style('stroke-width', '1px');
        this.labelSelection = labelEnter.merge(this.labelSelection);

        requestAnimationFrame(() => { this.updateLinkColors(); this.updateNodeColors(); });

        this.simulation.nodes(nodesData);
        this.simulation.force('link').links(linksData);
        this.simulation.alpha(0.3).restart();
    }

    updateNodeColors() {
        if (!this.nodeSelection || !this.labelSelection) return;
        this.nodeSelection
            .style('fill', d => d.type === 'folder' ? (d.isOpen ? '#ffa000' : '#ffca28') : (d.selected ? '#32CD32' : 'red'))
            .style('stroke', d => d.selected ? this.selectedNodeColor : this.nodeStrokeColor)
            .style('stroke-width', d => d.selected ? 2 : 1);
        this.labelSelection.style('font', d => d.selected ? 'bold 14px sans-serif' : '12px sans-serif');
    }

    updateLinkColors() {
        if (!this.linkSelection) return;
        this.linkSelection
            .style('stroke', d => (d.target.selected) ? this.selectedNodeColor : this.linkStrokeColor)
            .style('stroke-width', d => (d.target.selected) ? 2 : 1);
    }

    createDragHandler() {
        return d3.drag()
            .on("start", (event, d) => { if (!event.active) this.simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on("end", (event, d) => { if (!event.active) this.simulation.alphaTarget(0); d.fx = null; d.fy = null; });
    }

    throttledTick() {
        if (!this._lastTickTime) this._lastTickTime = 0;
        const now = Date.now();
        if (now - this._lastTickTime >= 16) { this.ticked(); this._lastTickTime = now; }
    }

    ticked() {
        if (!this.nodeSelection || !this.labelSelection || !this.linkSelection) return;
        const margin = 12;
        this.nodeSelection
            .attr('cx', d => d.x = Math.max(margin, Math.min(this.graphW - margin, d.x)))
            .attr('cy', d => d.y = Math.max(margin, Math.min(this.graphH - margin, d.y)));
        this.labelSelection.attr('x', d => d.x + 15).attr('y', d => d.y + 5)
            .style('font', d => d.selected ? 'bold 14px sans-serif' : '12px sans-serif')
            .style('stroke', this.nodeStrokeColor).style('fill', this.selectedNodeColor).raise();
        this.linkSelection
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    }

    lassoStart(event) {
        const p = d3.pointer(event);
        this.lassoStartPoint = { x: p[0], y: p[1] };
        this.lasso = this.svg.append('rect').attr('x', p[0]).attr('y', p[1])
            .attr('width', 0).attr('height', 0).attr('class', 'lasso');
    }

    lassoDraw(event) {
        if (!this.lassoStartPoint || !this.lasso) return;
        const p = d3.pointer(event);
        this.lasso.attr('x', Math.min(this.lassoStartPoint.x, p[0]))
            .attr('y', Math.min(this.lassoStartPoint.y, p[1]))
            .attr('width', Math.abs(this.lassoStartPoint.x - p[0]))
            .attr('height', Math.abs(this.lassoStartPoint.y - p[1]));
    }

    lassoCancel() {
        if (this.lasso) { this.lasso.remove(); this.lasso = null; this.lassoStartPoint = null; }
    }

    lassoEnd(event) {
        if (!this.lassoStartPoint) return;
        const p = d3.pointer(event);
        const x1 = Math.min(this.lassoStartPoint.x, p[0]), y1 = Math.min(this.lassoStartPoint.y, p[1]);
        const x2 = Math.max(this.lassoStartPoint.x, p[0]), y2 = Math.max(this.lassoStartPoint.y, p[1]);
        if (x2 - x1 > 5 && y2 - y1 > 5) {
            const sel = [];
            if (this.nodeSelection) {
                this.nodeSelection.each(function(d) {
                    if (d.x >= x1 && d.x <= x2 && d.y >= y1 && d.y <= y2) sel.push(d);
                });
            }
            if (sel.length > 0 && this.onLassoSelect) this.onLassoSelect(sel);
        }
        if (this.lasso) this.lasso.remove();
        this.lasso = null; this.lassoStartPoint = null;
    }

    cleanup() {
        if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
        if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
        if (this.simulation) this.simulation.stop();
    }
}

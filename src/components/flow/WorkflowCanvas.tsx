"use client";

import React, { useCallback, useState, useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as htmlToImage from "html-to-image";
import { Download, Undo2, Redo2 } from "lucide-react";

const initialNodes: Node[] = [
  {
    id: "lane-client",
    type: "group",
    data: { label: "Client Area" },
    position: { x: 0, y: 0 },
    style: { width: 600, height: 150, backgroundColor: "rgba(240, 240, 240, 0.5)" },
  },
  {
    id: "lane-system",
    type: "group",
    data: { label: "Tarkie System" },
    position: { x: 0, y: 160 },
    style: { width: 600, height: 150, backgroundColor: "rgba(210, 230, 255, 0.5)" },
  },
  {
    id: "step-1",
    data: { label: "User inputs data" },
    position: { x: 20, y: 50 },
    parentId: "lane-client",
    extent: "parent",
    style: { background: "#fff", border: "1px solid #1A73E8", borderRadius: "8px" },
  },
  {
    id: "step-2",
    data: { label: "System validates logic" },
    position: { x: 220, y: 50 },
    parentId: "lane-system",
    extent: "parent",
    style: { background: "#fff", border: "1px solid #1A73E8", borderRadius: "8px" },
  },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "step-1", target: "step-2", animated: true },
];

const EditableLabel = ({ id, value, className }: { id: string, value: string, className: string }) => {
  const { setNodes } = useReactFlow();
  const handleChange = (e: React.FocusEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.textContent || "";
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, label: newText } } : n));
  };
  return (
    <div 
      contentEditable 
      suppressContentEditableWarning 
      onBlur={handleChange} 
      className={`nodrag select-text outline-none cursor-text hover:bg-black/5 hover:ring-1 hover:ring-black/10 focus:bg-white focus:ring-2 focus:ring-primary rounded px-1 min-h-[20px] transition-all ${className}`}
      title="Double click or click to type"
    >
      {value}
    </div>
  );
};

// Lane color palette
const LANE_COLORS = [
  { bg: "rgba(219, 234, 254, 0.45)", border: "#3b82f6", sidebar: "#bfdbfe", text: "#1e40af" },  // blue
  { bg: "rgba(220, 252, 231, 0.45)", border: "#22c55e", sidebar: "#bbf7d0", text: "#166534" },  // green
  { bg: "rgba(254, 226, 226, 0.45)", border: "#ef4444", sidebar: "#fecaca", text: "#991b1b" },  // red
  { bg: "rgba(254, 249, 195, 0.45)", border: "#eab308", sidebar: "#fef08a", text: "#854d0e" },  // yellow
  { bg: "rgba(237, 233, 254, 0.45)", border: "#8b5cf6", sidebar: "#ddd6fe", text: "#5b21b6" },  // violet
  { bg: "rgba(254, 215, 170, 0.45)", border: "#f97316", sidebar: "#fed7aa", text: "#9a3412" },  // orange
  { bg: "rgba(207, 250, 254, 0.45)", border: "#06b6d4", sidebar: "#a5f3fc", text: "#155e75" },  // cyan
  { bg: "rgba(252, 231, 243, 0.45)", border: "#ec4899", sidebar: "#fbcfe8", text: "#9d174d" },  // pink
];

// Existing custom node styles
const nodeTypes = {
  swimlane: ({ id, data }: { id: string, data: any }) => {
    const colorIdx = data.colorIndex ?? 0;
    const color = LANE_COLORS[colorIdx % LANE_COLORS.length];
    return (
      <div className="relative flex shadow-sm pointer-events-none" style={{ width: data.width || 1200, height: data.height || 300, backgroundColor: color.bg, border: `2px solid ${color.border}`, borderRadius: 8 }}>
        <div className="w-14 h-full flex items-center justify-center pointer-events-auto" style={{ backgroundColor: color.sidebar, borderRight: `2px solid ${color.border}`, borderRadius: "6px 0 0 6px" }}>
           <span className="font-bold text-[10px] uppercase tracking-widest -rotate-90 whitespace-nowrap" style={{ color: color.text }}>
             <EditableLabel id={id} value={data.label as string} className="min-w-[50px] text-center" />
           </span>
        </div>
      </div>
    );
  },
  decision: ({ id, data }: { id: string, data: any }) => (
    <div className="relative flex items-center justify-center font-semibold text-xs text-center" style={{ width: 150, height: 150 }}>
      <div className="absolute inset-0 bg-amber-50 border-2 border-amber-400 shadow-sm" style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }} />
      <div className="relative z-10 px-4 py-2 max-w-[100px]">
        <EditableLabel id={id} value={data.label as string} className="min-w-[40px]" />
      </div>
      {/* All 4 handles — both source AND target on each side for maximum flexibility */}
      <Handle type="target" position={Position.Top} id="top" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="target" position={Position.Left} id="target-left" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="source" position={Position.Right} id="right" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="source" position={Position.Left} id="source-left" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="source" position={Position.Top} id="source-top" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="target" position={Position.Right} id="target-right" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-600" />
    </div>
  ),
  startend: ({ id, data }: { id: string, data: any }) => (
    <div className="flex items-center justify-center min-w-[120px] px-6 py-3 bg-slate-700 text-white font-bold text-[11px] uppercase tracking-wider text-center rounded-full shadow-md">
      <Handle type="target" position={Position.Top} id="top" className="!w-2 !h-2 !bg-white" />
      <Handle type="target" position={Position.Left} id="target-left" className="!w-2 !h-2 !bg-white" />
      <Handle type="target" position={Position.Right} id="target-right" className="!w-2 !h-2 !bg-white" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-2 !h-2 !bg-white" />
      <EditableLabel id={id} value={data.label as string} className="min-w-[40px]" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-2 !h-2 !bg-white" />
      <Handle type="source" position={Position.Right} id="right" className="!w-2 !h-2 !bg-white" />
      <Handle type="source" position={Position.Left} id="source-left" className="!w-2 !h-2 !bg-white" />
      <Handle type="source" position={Position.Top} id="source-top" className="!w-2 !h-2 !bg-white" />
    </div>
  ),
  process: ({ id, data }: { id: string, data: any }) => (
    <div className="flex items-center justify-center min-w-[160px] min-h-[60px] px-5 py-3 bg-white border-2 shadow-sm text-sm text-center rounded-xl font-medium tracking-tight text-slate-800 transition-all hover:shadow-md" style={{ borderColor: data.borderColor || "#94a3b8" }}>
      <Handle type="target" position={Position.Top} id="top" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="target" position={Position.Left} id="target-left" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="target" position={Position.Right} id="target-right" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className="!w-2 !h-2 !bg-slate-400" />
      <EditableLabel id={id} value={data.label as string} className="min-w-[80px]" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="source" position={Position.Right} id="right" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="source" position={Position.Left} id="source-left" className="!w-2 !h-2 !bg-slate-400" />
      <Handle type="source" position={Position.Top} id="source-top" className="!w-2 !h-2 !bg-slate-400" />
    </div>
  ),
};

function WorkflowCanvasInner({ 
  initialNodes = [], 
  initialEdges = [] 
}: { 
  initialNodes?: Node[], 
  initialEdges?: Edge[] 
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isExporting, setIsExporting] = useState(false);

  // Simple Undo/Redo Engine
  const [history, setHistory] = useState<{n: Node[], e: Edge[]}[]>([]);
  const [historyPointer, setPointer] = useState(-1);

  // Sync incoming AI generations into history!
  useEffect(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
      setHistory([{ n: initialNodes, e: initialEdges }]);
      setPointer(0);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const saveHistory = (newN: Node[], newE: Edge[]) => {
    const nextHist = history.slice(0, historyPointer + 1);
    nextHist.push({ n: newN, e: newE });
    setHistory(nextHist);
    setPointer(nextHist.length - 1);
  };

  const undo = () => {
    if (historyPointer > 0) {
      const prev = history[historyPointer - 1];
      setNodes(prev.n);
      setEdges(prev.e);
      setPointer(historyPointer - 1);
    }
  };

  const redo = () => {
    if (historyPointer < history.length - 1) {
      const next = history[historyPointer + 1];
      setNodes(next.n);
      setEdges(next.e);
      setPointer(historyPointer + 1);
    }
  };

  const onConnect = useCallback(
    (params: Connection) => {
       const newE = addEdge(params, edges);
       setEdges(newE);
       saveHistory(nodes, newE);
    },
    [setEdges, edges, nodes, historyPointer, history]
  );
  
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // XYFlow equivalent of reconnectEdge logic:
      setEdges((els) => {
         const newEdges = els.filter(e => e.id !== oldEdge.id);
         return addEdge(newConnection, newEdges);
      });
      // Save history after the state update
      setTimeout(() => saveHistory(nodes, edges), 50);
    },
    [setEdges, edges, nodes, historyPointer, history]
  );

  const onNodeDragStop = useCallback((e: any, node: Node) => {
    saveHistory(nodes, edges);
  }, [nodes, edges, historyPointer, history]);

   const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    // Allow deletion via context: click selects, then Backspace removes
  }, []);

  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    const remainingEdges = edges.filter(e => !deletedEdges.find(d => d.id === e.id));
    saveHistory(nodes, remainingEdges);
  }, [edges, nodes, historyPointer, history]);

  const { getNodes, getNodesBounds } = useReactFlow();

  const exportImage = () => {
    setIsExporting(true);
    // Allow React tick to remove the background grids
    setTimeout(() => {
      const nodeLayout = document.querySelector(".react-flow__viewport") as HTMLElement;
      if (!nodeLayout) {
        setIsExporting(false);
        return;
      }

      // Calculate the true dimensions of the entire flowchart
      const nodesBounds = getNodesBounds(getNodes());
      const width = nodesBounds.width + 100; // 50px padding on sides
      const height = nodesBounds.height + 100;

      // XYFlow official recommended full-image export strategy
      htmlToImage
        .toPng(nodeLayout, { 
          backgroundColor: "#ffffff",
          width: width,
          height: height,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${-nodesBounds.x + 50}px, ${-nodesBounds.y + 50}px) scale(1)`,
          }
        })
        .then((dataUrl) => {
          const a = document.createElement("a");
          a.setAttribute("download", "cst_workflow_full.png");
          a.setAttribute("href", dataUrl);
          a.click();
          setIsExporting(false);
        })
        .catch((error) => {
          console.error("Oops, something went wrong!", error);
          alert("Failed to export full image.");
          setIsExporting(false);
        });
    }, 150);
  };

  // Style edges for labels and selection
  const styledEdges = edges.map(e => ({
    ...e, 
    style: { stroke: "#94a3b8", strokeWidth: 2, ...e.style },
    labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#f8fafc", fillOpacity: 0.9 },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
    reconnectable: true,
  }));

  return (
    <div className="w-full h-full bg-slate-50 relative">
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <div className="flex bg-white shadow-sm border rounded-lg overflow-hidden">
          <button onClick={undo} disabled={historyPointer <= 0} className="px-3 py-2 bg-white text-slate-700 hover:bg-slate-50 border-r disabled:opacity-30" title="Undo"><Undo2 className="h-4 w-4" /></button>
          <button onClick={redo} disabled={historyPointer >= history.length - 1} className="px-3 py-2 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-30" title="Redo"><Redo2 className="h-4 w-4" /></button>
        </div>
        <button
          onClick={exportImage}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border shadow-sm rounded-lg hover:bg-slate-50 transition-colors font-medium text-sm"
        >
          <Download className="h-4 w-4" /> Export Clean PNG
        </button>
      </div>

      <div className="absolute top-4 left-4 z-10">
        <span className="text-[10px] font-medium text-slate-400 bg-white/80 border rounded px-2 py-1 flex flex-col gap-1">
          <span>• Click edge → select → Backspace to delete</span>
          <span>• Drag line ends to reconnect</span>
        </span>
      </div>

      <div className="w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          deleteKeyCode="Backspace"
          minZoom={0.1}
          maxZoom={2}
          fitView
        >
          {/* Hide background entirely when exporting for clean PNG */}
          {!isExporting && <Background color="#cbd5e1" gap={16} />}
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function WorkflowCanvas({ 
  initialNodes = [], 
  initialEdges = [] 
}: { 
  initialNodes?: Node[], 
  initialEdges?: Edge[] 
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner initialNodes={initialNodes} initialEdges={initialEdges} />
    </ReactFlowProvider>
  );
}

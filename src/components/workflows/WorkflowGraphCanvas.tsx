/**
 * The workflow canvas.
 *
 * Built on React Flow rather than hand-rolled pointer maths: panning, zoom,
 * node dragging, edge routing, multi-select and the minimap are all things a
 * graph editor is expected to do well, and doing them by hand is where the
 * previous canvas spent its complexity without matching the result.
 *
 * The graph is a projection of `WorkflowDefinition`, which stays the source of
 * truth. React Flow reports intent — this node moved, connect these two — and
 * the definition is updated from that, so undo/redo, autosave and validation
 * keep working against the same shape they always did.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
  type Connection,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, CircleCheck, Loader2 } from "lucide-react";

import {
  workflowNodeCatalogEntry,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowNodeRun,
} from "@/lib/workflows";
import { cn } from "@/lib/utils";

/** What each card needs to draw itself, carried on the React Flow node. */
type CardData = {
  node: WorkflowNode;
  selected: boolean;
  status?: WorkflowNodeRun["status"];
  invalid?: boolean;
  summary: string;
  logo?: React.ReactNode;
};

/** The card is a fixed size, so React Flow is told rather than made to measure. */
const CARD_WIDTH = 228;
const CARD_HEIGHT = 82;

const CATEGORY_ACCENT: Record<string, string> = {
  triggers: "bg-emerald-500",
  actions: "bg-amber-500",
  logic: "bg-violet-500",
};

/**
 * A one-line answer to "what is this step configured to do".
 *
 * Reading the node's own parameters rather than a generic description, so a
 * canvas of five "Send workspace email" nodes is still readable.
 */
const nodeSummary = (node: WorkflowNode) => {
  const parameters = node.parameters || {};
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = parameters[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number") return String(value);
    }
    return "";
  };
  if (node.type === "action.send_workspace_email") {
    const to = first("to", "recipient", "email");
    return to ? `To ${to}` : "No recipient set";
  }
  if (node.type === "action.http_request") {
    const url = first("url", "endpoint");
    return url ? `${first("method") || "POST"} ${url}` : "No endpoint set";
  }
  if (node.type === "logic.if") {
    const left = first("left", "field", "path");
    return left ? `If ${left} ${first("operator") || "equals"} ${first("right", "value")}` : "No condition set";
  }
  if (node.type === "logic.delay") {
    const seconds = first("seconds");
    return seconds ? `Wait ${seconds}s` : "No delay set";
  }
  if (node.type === "trigger.schedule") {
    const minutes = first("intervalMinutes");
    return minutes ? `Every ${minutes} min` : "Every 60 min";
  }
  if (node.type === "action.connected_app") {
    return first("operation") || "No action chosen";
  }
  return workflowNodeCatalogEntry(node.type)?.module || "";
};

const statusMark = (status?: WorkflowNodeRun["status"]) => {
  if (status === "success") {
    return <CircleCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "error") {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
  if (status === "running" || status === "queued" || status === "waiting") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />;
  }
  return null;
};

/**
 * One step on the canvas.
 *
 * Deliberately compact and free of permanent action buttons: the config panel
 * owns editing and the keyboard owns delete/duplicate, so the card only has to
 * say what the step is, what it is set to do, and whether it last worked.
 */
const WorkflowCard = memo(function WorkflowCard({ data, selected }: NodeProps) {
  const card = data as unknown as CardData;
  const entry = workflowNodeCatalogEntry(card.node.type);
  const isTrigger = entry?.category === "triggers";
  const mark = statusMark(card.status);

  return (
    <div
      className={cn(
        "w-[228px] overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-shadow",
        selected
          ? "border-primary ring-2 ring-primary/25"
          : card.invalid
            ? "border-destructive/60"
            : "border-border hover:shadow-md",
      )}
    >
      {/* A 2px category rail: type is readable at a glance without spending a
          full-colour surface on every card. */}
      <div className={cn("h-[2px] w-full", CATEGORY_ACCENT[entry?.category || "actions"])} />
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          {card.logo}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
              {card.node.name}
            </span>
            {mark}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
            {entry?.label || card.node.type}
          </span>
          {card.summary && (
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground/80">
              {card.summary}
            </span>
          )}
        </span>
      </div>

      {/* Triggers start the graph, so they take no input. */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-2 !border-background !bg-muted-foreground"
        />
      )}
      {(entry?.outputs || ["default"]).map((output, index, all) => (
        <Handle
          key={output}
          id={output === "default" ? undefined : output}
          type="source"
          position={Position.Right}
          style={
            all.length > 1
              ? { top: `${((index + 1) / (all.length + 1)) * 100}%` }
              : undefined
          }
          className="!h-2 !w-2 !border-2 !border-background !bg-primary"
        />
      ))}
      {/* Branch names live on the edges, where they say which path is which.
          Repeating them beside the handles labelled the same thing twice. */}
    </div>
  );
});

/**
 * Defined once at module scope. A `nodeTypes` object rebuilt on each render
 * makes React Flow treat every node type as new and remount the whole graph.
 */
const nodeTypes = { workflowCard: WorkflowCard };

function Graph({
  definition,
  selectedNodeId,
  nodeRuns,
  invalidNodeIds,
  renderLogo,
  onSelect,
  onDefinitionChange,
}: {
  definition: WorkflowDefinition;
  selectedNodeId: string | null;
  nodeRuns: Map<string, WorkflowNodeRun>;
  invalidNodeIds: Set<string>;
  renderLogo: (node: WorkflowNode) => React.ReactNode;
  onSelect: (nodeId: string | null) => void;
  /** `persist` is false while a drag is in flight, true once it settles. */
  onDefinitionChange: (next: WorkflowDefinition, persist: boolean) => void;
}) {
  const { fitView } = useReactFlow();
  const latest = useRef(definition);
  latest.current = definition;

  const nodes = useMemo<Node[]>(
    () =>
      definition.nodes.map((node) => ({
        id: node.id,
        type: "workflowCard",
        position: node.position,
        selected: node.id === selectedNodeId,
        // Declared rather than measured. The card is a fixed size, so this
        // saves React Flow a measurement pass and — the reason it is here —
        // gives the minimap dimensions to draw with, without which it renders
        // an empty frame.
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        data: {
          node,
          selected: node.id === selectedNodeId,
          status: nodeRuns.get(node.id)?.status,
          invalid: invalidNodeIds.has(node.id),
          summary: nodeSummary(node),
          logo: renderLogo(node),
        } satisfies CardData as unknown as Record<string, unknown>,
      })),
    [definition.nodes, selectedNodeId, nodeRuns, invalidNodeIds, renderLogo],
  );

  const edges = useMemo<Edge[]>(
    () =>
      definition.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceOutput || undefined,
        targetHandle: edge.targetInput || undefined,
        type: "smoothstep",
        animated: false,
        label: edge.sourceOutput,
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
        style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 },
      })),
    [definition.edges],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moves = changes.filter(
        (change): change is NodeChange & { id: string; position: { x: number; y: number }; dragging: boolean } =>
          change.type === "position" && "position" in change && Boolean(change.position),
      );
      if (moves.length === 0) return;
      const next = {
        ...latest.current,
        nodes: latest.current.nodes.map((node) => {
          const move = moves.find((change) => change.id === node.id);
          return move ? { ...node, position: move.position } : node;
        }),
      };
      // Only the drag's final frame is persisted; the frames in between would
      // otherwise fire an autosave per pointer move.
      const settled = moves.every((move) => move.dragging === false);
      onDefinitionChange(next, settled);
    },
    [onDefinitionChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(
        changes
          .filter((change): change is EdgeChange & { id: string } => change.type === "remove")
          .map((change) => change.id),
      );
      if (removed.size === 0) return;
      onDefinitionChange(
        {
          ...latest.current,
          edges: latest.current.edges.filter((edge) => !removed.has(edge.id)),
        },
        true,
      );
    },
    [onDefinitionChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const exists = latest.current.edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceOutput || "") === (connection.sourceHandle || ""),
      );
      if (exists) return;
      onDefinitionChange(
        {
          ...latest.current,
          edges: [
            ...latest.current.edges,
            {
              id: `edge-${connection.source}-${connection.target}-${latest.current.edges.length + 1}`,
              source: connection.source,
              target: connection.target,
              sourceOutput: connection.sourceHandle || undefined,
              targetInput: connection.targetHandle || undefined,
            },
          ],
        },
        true,
      );
    },
    [onDefinitionChange],
  );

  // Frame the graph on open and whenever the workflow being edited changes.
  const nodeCount = definition.nodes.length;
  useEffect(() => {
    if (nodeCount === 0) return;
    const timer = window.setTimeout(() => fitView({ padding: 0.25, duration: 200 }), 60);
    return () => window.clearTimeout(timer);
  }, [fitView, nodeCount]);

  // Re-frame when the pane itself changes size — entering or leaving focus
  // mode, or a narrow viewport restacking the columns. Without this the
  // viewport keeps a transform chosen for the old size and the graph sits
  // half off-screen, which reads as a broken canvas rather than a scrolled one.
  const paneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || nodeCount === 0) return;
    let frame = 0;
    let first = true;
    const observer = new ResizeObserver(() => {
      // The observer fires once on attach; that is the initial fit's job.
      if (first) {
        first = false;
        return;
      }
      window.clearTimeout(frame);
      frame = window.setTimeout(() => fitView({ padding: 0.25, duration: 160 }), 140);
    });
    observer.observe(pane);
    return () => {
      window.clearTimeout(frame);
      observer.disconnect();
    };
  }, [fitView, nodeCount]);

  return (
    <ReactFlow
      ref={paneRef}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onNodeClick={(_event, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      minZoom={0.25}
      maxZoom={1.75}
      // Tab reaches each step and the arrow keys move it, so building a
      // workflow is not mouse-only. React Flow provides this; it only needed
      // leaving on and given a visible focus state on the card.
      nodesFocusable
      edgesFocusable={false}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "smoothstep" }}
      // Deleting through React Flow would bypass the editor's undo stack.
      deleteKeyCode={null}
      // React Flow puts focus on its own node wrapper, so the ring is drawn
      // there rather than on the card inside it.
      className="bg-muted/20 [&_.react-flow__node:focus-visible]:outline-none [&_.react-flow__node:focus-visible]:ring-2 [&_.react-flow__node:focus-visible]:ring-primary/50 [&_.react-flow__node:focus-visible]:ring-offset-2 [&_.react-flow__node]:rounded-lg"
      aria-label="Workflow canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls
        showInteractive={false}
        className="!bottom-3 !left-3 !shadow-sm [&>button]:!h-7 [&>button]:!w-7 [&>button]:!border-border [&>button]:!bg-card"
      />
      {/* Only once the graph outgrows a screen. On a four-node workflow the
          minimap is a second picture of something already fully visible. */}
      {nodeCount > 8 && (
        <MiniMap
          pannable
          zoomable
          className="!bottom-3 !right-3 !h-24 !w-40 !rounded-md !border !border-border !bg-card"
          // Literal colours, not CSS variables: React Flow writes these onto
          // SVG fill attributes, where `hsl(var(--…))` does not resolve and the
          // minimap renders as an empty box.
          maskColor="rgba(100, 116, 139, 0.18)"
          nodeColor="#94a3b8"
          nodeStrokeWidth={0}
        />
      )}
    </ReactFlow>
  );
}

export function WorkflowGraphCanvas(props: React.ComponentProps<typeof Graph>) {
  if (props.definition.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-muted/20 text-center">
        <div>
          <p className="text-[13px] font-medium">Start with a trigger</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Choose one from the library to begin.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

export default WorkflowGraphCanvas;

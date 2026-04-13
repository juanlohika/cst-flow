import { NextResponse } from "next/server";
import { getModelForApp, getClaudeModel, getGeminiModel } from "@/lib/ai";
// getGroqModel is not exported — Groq-specific selection falls through to getModelForApp

const TAGLISH_RULE = `
SUPPORTED LANGUAGE (TAGLISH): The input source text/description may contain a mix of English and Filipino (Taglish). You must comprehend the meaning in both languages and ensure the final flowchart labels and text are written in formal, professional English.
`;

const MERMAID_PROMPT = `You are an expert Business Analyst. Analyze the process and extract a structured flowchart using **Mermaid.js Markdown syntax**.
${TAGLISH_RULE}

CRITICAL RULES:
1. You MUST use exactly this wrapper:
\`\`\`mermaid
flowchart TD
    %% Your code here
\`\`\`
2. Keep node titles short and concise.
3. Use proper node shapes: Start/End: \`id([Label])\`, Process: \`id(Label)\`, Decision: \`id{Label}\`
4. Always label decision branches (e.g., \`A -->|Yes| B\`).
5. NO OTHER TEXT. ONLY THE MERMAID CODE BLOCK!`;

const MERMAID_SEQUENCE_PROMPT = `You are an expert Business Analyst. Extract the process into a Mermaid.js Sequence Diagram.
${TAGLISH_RULE}

CRITICAL RULES:
1. You MUST use exactly this wrapper:
\`\`\`mermaid
sequenceDiagram
    %% Your code here
\`\`\`
2. Identify actors using \`participant A as Label\`.
3. Use \`A->>B: Message\` format for interactions.
4. Use \`alt\` / \`else\` / \`end\` for decision branches.
5. NO OTHER TEXT. ONLY THE MERMAID CODE BLOCK!`;


const REACT_FLOW_PROMPT = `You are an expert AI Architect mapping process flowcharts.
${TAGLISH_RULE}
Extract the process into highly structured raw JSON. Do NOT wrap inside markdown blocks. Output only parseable JSON!

{
  "lanes": [
    { "id": "client", "name": "Client Team" },
    { "id": "dev", "name": "Development" }
  ],
  "steps": [
    { "id": "s1", "label": "Start Process", "type": "start", "lane": "client" },
    { "id": "s2", "label": "Review Code?", "type": "decision", "lane": "dev" },
    { "id": "s3", "label": "End", "type": "end", "lane": "client" }
  ],
  "connections": [
    { "from": "s1", "to": "s2" },
    { "from": "s2", "to": "s3", "label": "Yes" }
  ]
}

RULES:
1. "lane" MUST match a lane ID exactly.
2. "type" MUST be one of: "start", "end", "process", "decision".
3. ONLY output RAW JSON. No chat phrasing.`;

export async function POST(req: Request) {
  try {
    const { prompt, messages, diagramType, systemInstruction, provider, images } = await req.json();
    const hasImages = Array.isArray(images) && images.length > 0;

    // ── Resolve AI model ──────────────────────────────────────────────────────
    // If images are attached, always use Claude (Groq/Gemini free tier can't read images reliably).
    // If provider override is set, use that. Otherwise fall back to app default.
    let model: any;
    const resolvedProvider = hasImages ? "claude" : (provider || "auto");

    if (resolvedProvider === "claude") {
      model = await getClaudeModel();
    } else if (resolvedProvider === "gemini") {
      model = await getGeminiModel();
    } else if (resolvedProvider === "groq") {
      // Groq doesn't have its own exported getter — use getModelForApp with groq as primary
      // getModelForApp will pick up the app's setting; user must configure app to groq in admin
      model = await getModelForApp("architect");
    } else {
      // "auto" — use the app's configured provider
      model = await getModelForApp("architect");
    }

    // Choose prompting strategy based on dropdown
    const isMermaid = diagramType.startsWith("mermaid");
    let finalInstruction = REACT_FLOW_PROMPT;
    if (diagramType === "mermaid") finalInstruction = MERMAID_PROMPT;
    if (diagramType === "mermaid-sequence") finalInstruction = MERMAID_SEQUENCE_PROMPT;

    if (hasImages) {
      finalInstruction += `\n\nIMAGE ANALYSIS: The user has attached ${images.length} screenshot(s). Analyze each image carefully to understand the process, UI flow, or system shown, then extract that into the diagram format.`;
    }

    if (systemInstruction) {
      const isMermaidInstruction = systemInstruction.toLowerCase().includes("mermaid");
      if (!isMermaid && isMermaidInstruction) {
        console.log("Skipping Mermaid overrides for JSON engine to prevent AI hallucination.");
      } else {
        finalInstruction += `\n\nADDITIONAL INSTRUCTIONS:\n${systemInstruction}`;
      }
    }

    // ── Build contents with images in the last user message ──────────────────
    let requestContents: any[];

    if (hasImages) {
      // Build history as text-only, then append images to the final user turn
      const history = (messages || []).slice(0, -1).map((m: any) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));

      const lastParts: any[] = [];
      if (prompt) lastParts.push({ text: prompt });
      for (const img of images) {
        lastParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
      }

      requestContents = [
        ...history,
        { role: "user", parts: lastParts },
      ];
    } else {
      requestContents = messages && messages.length > 0
        ? messages.map((m: any) => ({ role: m.role, parts: [{ text: m.content }] }))
        : [{ role: "user", parts: [{ text: prompt }] }];
    }

    // Retry up to 3 times on Claude overload (529)
    let result: any;
    const delays = [4000, 8000, 15000];
    for (let attempt = 0; ; attempt++) {
      try {
        result = await model.generateContent({
          contents: requestContents,
          systemInstruction: { role: "system", parts: [{ text: finalInstruction }] },
        });
        break;
      } catch (aiErr: any) {
        const isOverloaded =
          aiErr?.status === 529 ||
          aiErr?.message?.toLowerCase().includes("overload") ||
          aiErr?.error?.type === "overloaded_error";
        if (isOverloaded && attempt < delays.length) {
          console.warn(`[architect/generate] Claude overloaded, retrying in ${delays[attempt]}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw aiErr;
      }
    }

    const text = result.response.text();

    // ──────────────────────────────────────────────
    // RETURN MERMAID STRING
    // ──────────────────────────────────────────────
    if (isMermaid) {
      const match = text.match(/```mermaid([\s\S]*?)```/i);
      let cleanChart = match && match[1] ? match[1].trim() : text.replace(/```/g, '').trim();
      return NextResponse.json({ chart: cleanChart });
    }

    // ──────────────────────────────────────────────
    // REACT FLOW LAYOUT ENGINE (With Cycle Breaking)
    // ──────────────────────────────────────────────
    let aiOutput;
    try {
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      aiOutput = JSON.parse(jsonStr);
    } catch (e) {
      return NextResponse.json({ error: "AI produced invalid JSON topology." }, { status: 500 });
    }

    const { nodes, edges } = layoutReactFlow(aiOutput);
    return NextResponse.json({ nodes, edges });

  } catch (error: any) {
    let msg = error.message;
    const isOverloaded =
      error?.status === 529 ||
      msg?.toLowerCase().includes("overload") ||
      error?.error?.type === "overloaded_error";
    if (isOverloaded) {
      msg = "Claude is temporarily overloaded. Please wait a moment and try again.";
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    if (msg && (msg.includes("429 Too Many Requests") || msg.includes("Quota exceeded"))) {
      msg = "⌛ Google AI Free Tier Limit Reached. Please wait 30 seconds before generating your next flowchart!";
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ──────────────────────────────────────────────
// DAGRE-LIKE CUSTOM LAYOUT ENGINE
// ──────────────────────────────────────────────
function layoutReactFlow(ai: any) {
  const LANE_PADDING_LEFT = 350;
  const NODE_SPACING_X = 350;
  const LANE_MIN_HEIGHT = 200;
  
  if (!ai.lanes) ai.lanes = [];
  if (!ai.steps) ai.steps = [];
  if (!ai.connections) ai.connections = [];

  // 1. Build Adjacency List
  const adj: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  ai.steps.forEach((s: any) => { adj[s.id] = []; inDegree[s.id] = 0; });
  
  ai.connections.forEach((c: any) => {
    if (!adj[c.from]) adj[c.from] = [];
    adj[c.from].push(c.to);
    if (inDegree[c.to] !== undefined) inDegree[c.to]++;
  });

  // 2. DFS Cycle Breaking (Remove back-edges to form DAG)
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dagAdj: Record<string, string[]> = {};
  
  function dfs(u: string) {
    visiting.add(u);
    dagAdj[u] = [];
    for (const v of (adj[u] || [])) {
      if (visiting.has(v)) continue; // Broken Cycle!
      dagAdj[u].push(v);
      if (!visited.has(v)) dfs(v);
    }
    visiting.delete(u);
    visited.add(u);
  }

  ai.steps.forEach((s: any) => { if (!visited.has(s.id)) dfs(s.id); });

  // 3. Compute Topological Depth (X axis)
  const depth: Record<string, number> = {};
  ai.steps.forEach((s: any) => depth[s.id] = 0);
  
  const starts = ai.steps.filter((s: any) => inDegree[s.id] === 0 || s.type === "start");
  if (starts.length === 0 && ai.steps.length > 0) starts.push(ai.steps[0]);

  const queue: {id: string, d: number}[] = starts.map((s: any) => ({id: s.id, d: 0}));
  let circuitBreaker = 0;
  
  while (queue.length > 0 && circuitBreaker < 10000) {
    circuitBreaker++;
    const {id, d} = queue.shift()!;
    if (d > (depth[id] || 0)) depth[id] = d;

    // Use dagAdj so cycles don't cause infinite depth
    for (const next of (dagAdj[id] || [])) {
      if ((depth[next] || 0) < d + 1) {
        depth[next] = d + 1;
        queue.push({id: next, d: d + 1});
      }
    }
  }

  // 4. Resolve exact X,Y collisions within Lanes
  const positionMap: Record<string, {x: number, y: number, lane: string}> = {};
  const depthLaneCounts: Record<string, number> = {}; // Tracks vertical stacking in parallel lanes

  const normalizeLane = (l: string) => String(l || "default").toLowerCase().replace(/[^a-z0-9]/g, "_");

  ai.steps.forEach((step: any) => {
    const d = depth[step.id];
    const laneId = normalizeLane(step.lane);
    const key = `${laneId}-${d}`;
    if (!depthLaneCounts[key]) depthLaneCounts[key] = 0;
    
    positionMap[step.id] = {
      x: LANE_PADDING_LEFT + d * NODE_SPACING_X,
      y: 60 + depthLaneCounts[key] * 120, // Stack parallel nodes vertically
      lane: laneId
    };
    depthLaneCounts[key]++;
  });

  // 5. Draw Canvas Items
  const maxDepth = Math.max(...Object.values(depth) as number[], 0);
  const laneWidth = Math.max(1200, LANE_PADDING_LEFT + (maxDepth + 1.5) * NODE_SPACING_X);
  
  const nodes: any[] = [];
  const edges: any[] = [];
  let currentY = 0;
  const laneIndexMap: Record<string, number> = {};

  const detectedLanes = Array.from(new Set<string>(ai.steps.map((s: any) => normalizeLane(s.lane))));
  if (ai.lanes.length === 0) {
     ai.lanes = detectedLanes.map((id: string) => ({ id, name: String(id).toUpperCase().replace(/_/g, " ") }));
  } else {
     // Validate all steps fall into defined lanes, otherwise merge them
     const definedLaneIds = new Set(ai.lanes.map((l: any) => normalizeLane(l.id)));
     detectedLanes.forEach((id: string) => {
        if (!definedLaneIds.has(id)) {
           ai.lanes.push({ id, name: id.toUpperCase().replace(/_/g, " ") });
        }
     });
  }

  ai.lanes.forEach((lane: any, idx: number) => {
    const laneId = normalizeLane(lane.id);
    let maxRows = 1;
    for (let d = 0; d <= maxDepth; d++) {
      if ((depthLaneCounts[`${laneId}-${d}`] || 0) > maxRows) {
        maxRows = depthLaneCounts[`${laneId}-${d}`];
      }
    }

    const laneHeight = Math.max(LANE_MIN_HEIGHT, 60 + maxRows * 120);

    nodes.push({
      id: `lane-${laneId}`,
      type: "swimlane",
      data: { label: lane.name, width: laneWidth, height: laneHeight, colorIndex: idx },
      position: { x: 0, y: currentY },
      style: { width: laneWidth, height: laneHeight },
      draggable: false,
      selectable: false,
      zIndex: -1,
    });

    laneIndexMap[laneId] = idx;
    currentY += laneHeight + 20;
  });

  ai.steps.forEach((step: any) => {
    const pos = positionMap[step.id];
    if (!pos) return;
    
    let nodeType = "process";
    if (step.type === "decision") nodeType = "decision";
    if (step.type === "start" || step.type === "end" || step.type === "startend") nodeType = "startend";

    nodes.push({
      id: step.id,
      type: nodeType,
      data: { label: step.label },
      position: { x: pos.x, y: pos.y },
      parentId: `lane-${pos.lane}`,
      extent: "parent",
    });
  });

  ai.connections.forEach((conn: any, i: number) => {
    const srcPos = positionMap[conn.from];
    const tgtPos = positionMap[conn.to];
    if (!srcPos || !tgtPos) return;

    let sourceHandle = "right";
    let targetHandle = "target-left";
    const tgtLaneIdx = laneIndexMap[tgtPos.lane] ?? 0;
    const srcLaneIdx = laneIndexMap[srcPos.lane] ?? 0;

    if (srcPos.lane === tgtPos.lane) {
      if (tgtPos.x < srcPos.x) {
        sourceHandle = "source-left"; targetHandle = "target-right"; // Loopback
      } else if (tgtPos.x === srcPos.x) {
        sourceHandle = "bottom"; targetHandle = "top"; // Parallel Stacked
      }
    } else if (tgtLaneIdx > srcLaneIdx) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else {
       sourceHandle = "source-top"; targetHandle = "target-bottom";
    }

    // specific routing overrides for "No" branches
    const srcStep = ai.steps.find((s: any) => s.id === conn.from);
    if (srcStep?.type === "decision" && conn.label === "No") {
      sourceHandle = "right"; targetHandle = "target-left";
    }

    edges.push({
      id: `e-${conn.from}-${conn.to}-${i}`,
      source: conn.from, target: conn.to,
      sourceHandle, targetHandle,
      ...(conn.label ? { label: conn.label } : {}),
    });
  });

  return { nodes, edges };
}

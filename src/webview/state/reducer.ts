import {
  addAxis,
  addPlot,
  addTrace,
  clearActivePlot,
  clearLayout,
  reorderAxis,
  removeAxis,
  removePlot,
  removeTrace,
  renamePlot,
  reassignAxisTraces,
  setActivePlot,
  setPlotXSignal,
  setPlotXRange,
  updatePlotXAxis,
  setTraceAxis,
  setTraceVisible,
  updateAxis,
  type WorkspaceState
} from "./workspaceState";

export type WorkspaceAction =
  | { type: "workspace/clearLayout" }
  | { type: "plot/add"; payload?: { xSignal?: string; name?: string } }
  | { type: "plot/clear"; payload?: { plotId?: string } }
  | { type: "plot/remove"; payload: { plotId: string } }
  | { type: "plot/rename"; payload: { plotId: string; name: string } }
  | { type: "plot/setActive"; payload: { plotId: string } }
  | { type: "plot/setXSignal"; payload: { plotId?: string; xSignal: string } }
  | { type: "plot/setXRange"; payload: { plotId?: string; xRange?: [number, number] } }
  | {
      type: "plot/updateXAxis";
      payload: {
        plotId?: string;
        patch: { scale?: "linear" | "log"; xRange?: [number, number] };
        xValues?: readonly number[];
      };
    }
  | { type: "axis/add"; payload?: { plotId?: string; afterAxisId?: `y${number}` } }
  | { type: "axis/reorder"; payload: { plotId?: string; axisId: `y${number}`; toIndex: number } }
  | {
      type: "axis/remove";
      payload: { plotId?: string; axisId: `y${number}`; reassignToAxisId?: `y${number}` };
    }
  | {
      type: "axis/reassignTraces";
      payload: { plotId?: string; fromAxisId: `y${number}`; toAxisId: `y${number}` };
    }
  | {
      type: "axis/update";
      payload: {
        plotId?: string;
        axisId: `y${number}`;
        patch: Partial<{
          title: string;
          range: [number, number];
          scale: "linear" | "log";
        }>;
      };
    }
  | {
      type: "trace/add";
      payload: { plotId?: string; signal: string; sourceId?: string; axisId?: `y${number}` };
    }
  | {
      type: "trace/setAxis";
      payload: { plotId?: string; traceId: string; axisId: `y${number}` };
    }
  | {
      type: "trace/setVisible";
      payload: { plotId?: string; traceId: string; visible: boolean };
    }
  | { type: "trace/remove"; payload: { plotId?: string; traceId: string } };

export function reduceWorkspaceState(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "workspace/clearLayout":
      return clearLayout(state);
    case "plot/add":
      return addPlot(state, action.payload ?? {});
    case "plot/clear":
      return clearActivePlot(state, action.payload ?? {});
    case "plot/remove":
      return removePlot(state, action.payload);
    case "plot/rename":
      return renamePlot(state, action.payload);
    case "plot/setActive":
      return setActivePlot(state, action.payload);
    case "plot/setXSignal":
      return setPlotXSignal(state, action.payload);
    case "plot/setXRange":
      return setPlotXRange(state, action.payload);
    case "plot/updateXAxis":
      return updatePlotXAxis(state, action.payload);
    case "axis/add":
      return addAxis(state, action.payload ?? {});
    case "axis/reorder":
      return reorderAxis(state, action.payload);
    case "axis/remove":
      return removeAxis(state, action.payload);
    case "axis/reassignTraces":
      return reassignAxisTraces(state, action.payload);
    case "axis/update":
      return updateAxis(state, action.payload);
    case "trace/add":
      return addTrace(state, action.payload);
    case "trace/setAxis":
      return setTraceAxis(state, action.payload);
    case "trace/setVisible":
      return setTraceVisible(state, action.payload);
    case "trace/remove":
      return removeTrace(state, action.payload);
    default:
      return state;
  }
}

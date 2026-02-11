export type AxisId = `y${number}`;

export type AxisState = {
  id: AxisId;
  side?: "left" | "right";
  title?: string;
  range?: [number, number];
  scale?: "linear" | "log";
};

export type TraceState = {
  id: string;
  signal: string;
  axisId: AxisId;
  visible: boolean;
  color?: string;
  lineWidth?: number;
};

export type PlotState = {
  id: string;
  name: string;
  xSignal: string;
  axes: AxisState[];
  traces: TraceState[];
  nextAxisNumber: number;
  xRange?: [number, number];
};

export type WorkspaceState = {
  activePlotId: string;
  plots: PlotState[];
};

export function createWorkspaceState(defaultXSignal: string): WorkspaceState {
  return {
    activePlotId: "plot-1",
    plots: [createPlotState({ id: "plot-1", name: "Plot 1", xSignal: defaultXSignal })]
  };
}

export function getActivePlot(state: WorkspaceState): PlotState {
  return getPlotOrThrow(state, state.activePlotId);
}

export function addPlot(
  state: WorkspaceState,
  options: { xSignal: string; name?: string } | { xSignal?: string; name?: string } = {}
): WorkspaceState {
  const activePlot = getActivePlot(state);
  const nextPlotIndex = getNextIdNumber(
    state.plots.map((plot) => plot.id),
    /^plot-(\d+)$/
  );
  const plotId = `plot-${nextPlotIndex}`;
  const plotName = options.name?.trim() || `Plot ${nextPlotIndex}`;
  const xSignal = options.xSignal ?? activePlot.xSignal;
  const nextPlot = createPlotState({ id: plotId, name: plotName, xSignal });

  return {
    activePlotId: plotId,
    plots: [...state.plots, nextPlot]
  };
}

export function removePlot(state: WorkspaceState, payload: { plotId: string }): WorkspaceState {
  if (state.plots.length <= 1) {
    throw new Error("Cannot remove the only plot tab.");
  }

  const nextPlots = state.plots.filter((plot) => plot.id !== payload.plotId);
  if (nextPlots.length === state.plots.length) {
    throw new Error(`Unknown plot id: ${payload.plotId}`);
  }

  const nextActivePlotId =
    state.activePlotId === payload.plotId ? nextPlots[nextPlots.length - 1]?.id ?? "" : state.activePlotId;

  return {
    activePlotId: nextActivePlotId,
    plots: nextPlots
  };
}

export function renamePlot(
  state: WorkspaceState,
  payload: { plotId: string; name: string }
): WorkspaceState {
  const name = payload.name.trim();
  if (!name) {
    throw new Error("Plot name cannot be empty.");
  }

  return withUpdatedPlot(state, payload.plotId, (plot) => ({
    ...plot,
    name
  }));
}

export function setActivePlot(
  state: WorkspaceState,
  payload: { plotId: string }
): WorkspaceState {
  getPlotOrThrow(state, payload.plotId);
  return {
    ...state,
    activePlotId: payload.plotId
  };
}

export function setPlotXSignal(
  state: WorkspaceState,
  payload: { plotId?: string; xSignal: string }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => ({
    ...plot,
    xSignal: payload.xSignal
  }));
}

export function setPlotXRange(
  state: WorkspaceState,
  payload: { plotId?: string; xRange?: [number, number] }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => ({
    ...plot,
    xRange: payload.xRange
  }));
}

export function addAxis(
  state: WorkspaceState,
  payload: { plotId?: string } = {}
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => {
    const nextAxisId = `y${plot.nextAxisNumber}` as AxisId;

    return {
      ...plot,
      axes: [...plot.axes, { id: nextAxisId }],
      nextAxisNumber: plot.nextAxisNumber + 1
    };
  });
}

export function updateAxis(
  state: WorkspaceState,
  payload: { plotId?: string; axisId: AxisId; patch: Partial<Omit<AxisState, "id">> }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => ({
    ...plot,
    axes: plot.axes.map((axis) => {
      if (axis.id !== payload.axisId) {
        return axis;
      }
      return { ...axis, ...payload.patch };
    })
  }));
}

export function reassignAxisTraces(
  state: WorkspaceState,
  payload: { plotId?: string; fromAxisId: AxisId; toAxisId: AxisId }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;

  if (payload.fromAxisId === payload.toAxisId) {
    return state;
  }

  return withUpdatedPlot(state, plotId, (plot) => {
    assertAxisExists(plot, payload.fromAxisId);
    assertAxisExists(plot, payload.toAxisId);

    return {
      ...plot,
      traces: plot.traces.map((trace) =>
        trace.axisId === payload.fromAxisId ? { ...trace, axisId: payload.toAxisId } : trace
      )
    };
  });
}

export function removeAxis(
  state: WorkspaceState,
  payload: { plotId?: string; axisId: AxisId; reassignToAxisId?: AxisId }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;

  return withUpdatedPlot(state, plotId, (plot) => {
    assertAxisExists(plot, payload.axisId);

    if (plot.axes.length <= 1) {
      throw new Error("Cannot remove the only axis.");
    }

    const tracesUsingAxis = plot.traces.filter((trace) => trace.axisId === payload.axisId);
    if (tracesUsingAxis.length > 0 && !payload.reassignToAxisId) {
      throw new Error(`Cannot remove axis ${payload.axisId} because traces are still assigned.`);
    }

    if (payload.reassignToAxisId) {
      assertAxisExists(plot, payload.reassignToAxisId);
      if (payload.reassignToAxisId === payload.axisId) {
        throw new Error("Axis reassignment target must differ from removed axis.");
      }
    }

    const nextTraces = payload.reassignToAxisId
      ? plot.traces.map((trace) =>
          trace.axisId === payload.axisId ? { ...trace, axisId: payload.reassignToAxisId! } : trace
        )
      : plot.traces;

    return {
      ...plot,
      axes: plot.axes.filter((axis) => axis.id !== payload.axisId),
      traces: nextTraces
    };
  });
}

export function reorderAxis(
  state: WorkspaceState,
  payload: { plotId?: string; axisId: AxisId; toIndex: number }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;

  return withUpdatedPlot(state, plotId, (plot) => {
    assertAxisExists(plot, payload.axisId);

    if (
      !Number.isInteger(payload.toIndex) ||
      payload.toIndex < 0 ||
      payload.toIndex >= plot.axes.length
    ) {
      throw new Error("Axis reorder index out of bounds.");
    }

    const fromIndex = plot.axes.findIndex((axis) => axis.id === payload.axisId);
    if (fromIndex < 0) {
      throw new Error(`Unknown axis id: ${payload.axisId}`);
    }

    if (fromIndex === payload.toIndex) {
      return plot;
    }

    const nextAxes = plot.axes.slice();
    const [movedAxis] = nextAxes.splice(fromIndex, 1);
    nextAxes.splice(payload.toIndex, 0, movedAxis as AxisState);

    return {
      ...plot,
      axes: nextAxes
    };
  });
}

export function addTrace(
  state: WorkspaceState,
  payload: { plotId?: string; signal: string; axisId?: AxisId }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => {
    const axisId = payload.axisId ?? plot.axes[0]?.id;
    if (!axisId) {
      throw new Error("Cannot add trace because plot has no axes.");
    }

    assertAxisExists(plot, axisId);

    const nextTraceId = `trace-${getNextIdNumber(
      plot.traces.map((trace) => trace.id),
      /^trace-(\d+)$/
    )}`;

    return {
      ...plot,
      traces: [
        ...plot.traces,
        {
          id: nextTraceId,
          signal: payload.signal,
          axisId,
          visible: true
        }
      ]
    };
  });
}

export function setTraceAxis(
  state: WorkspaceState,
  payload: { plotId?: string; traceId: string; axisId: AxisId }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => {
    assertAxisExists(plot, payload.axisId);
    if (!plot.traces.some((trace) => trace.id === payload.traceId)) {
      throw new Error(`Unknown trace id: ${payload.traceId}`);
    }

    return {
      ...plot,
      traces: plot.traces.map((trace) =>
        trace.id === payload.traceId ? { ...trace, axisId: payload.axisId } : trace
      )
    };
  });
}

export function setTraceVisible(
  state: WorkspaceState,
  payload: { plotId?: string; traceId: string; visible: boolean }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => {
    if (!plot.traces.some((trace) => trace.id === payload.traceId)) {
      throw new Error(`Unknown trace id: ${payload.traceId}`);
    }

    return {
      ...plot,
      traces: plot.traces.map((trace) =>
        trace.id === payload.traceId ? { ...trace, visible: payload.visible } : trace
      )
    };
  });
}

export function removeTrace(
  state: WorkspaceState,
  payload: { plotId?: string; traceId: string }
): WorkspaceState {
  const plotId = payload.plotId ?? state.activePlotId;
  return withUpdatedPlot(state, plotId, (plot) => {
    if (!plot.traces.some((trace) => trace.id === payload.traceId)) {
      throw new Error(`Unknown trace id: ${payload.traceId}`);
    }

    return {
      ...plot,
      traces: plot.traces.filter((trace) => trace.id !== payload.traceId)
    };
  });
}

function createPlotState(payload: { id: string; name: string; xSignal: string }): PlotState {
  return {
    id: payload.id,
    name: payload.name,
    xSignal: payload.xSignal,
    axes: [{ id: "y1" }],
    traces: [],
    nextAxisNumber: 2
  };
}

function withUpdatedPlot(
  state: WorkspaceState,
  plotId: string,
  update: (plot: PlotState) => PlotState
): WorkspaceState {
  const index = state.plots.findIndex((plot) => plot.id === plotId);
  if (index < 0) {
    throw new Error(`Unknown plot id: ${plotId}`);
  }

  const nextPlots = state.plots.slice();
  nextPlots[index] = update(state.plots[index] as PlotState);

  return {
    ...state,
    plots: nextPlots
  };
}

function getPlotOrThrow(state: WorkspaceState, plotId: string): PlotState {
  const plot = state.plots.find((entry) => entry.id === plotId);
  if (!plot) {
    throw new Error(`Unknown plot id: ${plotId}`);
  }
  return plot;
}

function assertAxisExists(plot: PlotState, axisId: AxisId): void {
  if (!plot.axes.some((axis) => axis.id === axisId)) {
    throw new Error(`Unknown axis id: ${axisId}`);
  }
}

function getNextIdNumber(values: string[], matcher: RegExp): number {
  let max = 0;
  for (const value of values) {
    const match = value.match(matcher);
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1] as string, 10);
    if (Number.isFinite(parsed) && parsed > max) {
      max = parsed;
    }
  }
  return max + 1;
}

# Lessons Learned

- Plotly rangeslider interactions can split by hit target: dragging over miniature trace paths may trigger different behavior than dragging over empty slider background.
- For consistent “drag window to pan range” behavior, avoid forcing `xaxis.rangeslider.range`/`autorange` on each render; keep rangeslider config minimal (`visible`, optional `thickness`) and let Plotly manage slider window state.
- If slider drag still differs over trace vs non-trace areas, disable pointer hit-testing on the rangeslider miniature trace layer (`.rangeslider-rangeplot, .rangeslider-rangeplot * { pointer-events: none; }`) so drag events route to the slider window/handles uniformly.

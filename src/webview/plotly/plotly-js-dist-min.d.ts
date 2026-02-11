declare module "plotly.js-dist-min" {
  const Plotly: {
    react(
      root: HTMLElement,
      data: unknown[],
      layout: Record<string, unknown>,
      config?: Record<string, unknown>
    ): Promise<unknown>;
  };

  export default Plotly;
}

# ImageToVector tracing approach

The browser demo now follows a conventional full-color vectorization pipeline:

1. Reduce raster colors into a configurable palette with iterative clustering.
2. Relabel nearby pixels with a local smoothness penalty to reduce isolated noisy color changes.
3. Trace each color region's boundary, including holes and transparent pixels.
4. Simplify the boundary and fit rounded quadratic SVG path segments.
5. Export actual SVG paths; no source bitmap is embedded in the SVG.

The public information available for Vector Magic describes automatic full-color tracing, edge placement at sub-pixel precision, and choosing a compact set of nodes. An independent public reimplementation describes Bayesian image vectorization, antialiasing-aware sub-pixel placement, speckle merging, and cubic Bézier fitting. ImageToVector is an independent browser implementation of related general tracing concepts; it does not copy Vector Magic's proprietary engine or currently implement Bayesian sub-pixel edge inference, manual region editing, or the same curve-fitting method. The exact Vector Magic implementation is not publicly documented in source form.

This is a useful MVP trace engine, not a claim of equal quality to Vector Magic. Flat-color logos and illustrations should work better than fine-texture photographs. Review SVGs before printing, cutting, embroidery, or other production use.

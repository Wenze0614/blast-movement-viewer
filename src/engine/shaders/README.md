# src/engine/shaders

`*.glsl.ts` modules: `export default /* glsl */ \`…\``, with a typed uniforms object next to each
shader. Shared chunks live in `chunks/` and are interpolated into templates. No loaders, no global
`ShaderChunk` overrides, no `onBeforeCompile` without a comment explaining why.

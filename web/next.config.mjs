/** A static site: Caddy serves it and sends /api to the control server. */
const config = { output: 'export', trailingSlash: true, images: { unoptimized: true } };
export default config;

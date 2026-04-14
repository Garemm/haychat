/**
 * babel.config.cjs
 *
 * Babel configuration for Jest.
 *
 * WHY .cjs EXTENSION:
 *   The backend uses "type": "module" so all .js files are treated as ESM.
 *   Babel config files must be .cjs so Node.js loads them as CommonJS
 *   (babel requires its own config file before transforms are applied).
 *
 * WHAT IT DOES:
 *   @babel/preset-env compiles ES Modules (import/export) → CommonJS
 *   (require/module.exports) so Jest can run them without --experimental-vm-modules.
 *   The server itself runs native ESM at runtime; only Jest uses this transform.
 */
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { node: 'current' },
      },
    ],
  ],
};

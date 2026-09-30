// craco.config.js
const path = require("path");
require("dotenv").config();

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      env: { browser: true, es2022: true, jest: true, node: true, serviceworker: true },
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      plugins: ["react"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
        // A name that is not defined only fails when that code runs (e.g. a missing import): stop the build instead.
        "no-undef": "error",
        "react/jsx-no-undef": "error",
        "react/jsx-uses-vars": "error",
        "react/jsx-uses-react": "error",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  devServerConfig.proxy = {
    ...(devServerConfig.proxy || {}),
    "/api": {
      target: process.env.REACT_APP_BACKEND_PROXY_TARGET || "http://localhost:4001",
      changeOrigin: true,
    },
  };
  devServerConfig.historyApiFallback = {
    ...(devServerConfig.historyApiFallback || {}),
    disableDotRule: true,
    index: "/index.html",
  };

  const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

  devServerConfig.setupMiddlewares = (middlewares, devServer) => {
    middlewares.unshift({
      name: "spa-route-fallback",
      middleware: (req, _res, next) => {
        const requestUrl = req.url || "";
        const isPageRequest =
          req.method === "GET" &&
          !requestUrl.startsWith("/api") &&
          !requestUrl.startsWith("/static") &&
          !requestUrl.includes(".");

        if (isPageRequest) {
          req.url = "/";
        }

        next();
      },
    });

    if (originalSetupMiddlewares) {
      middlewares = originalSetupMiddlewares(middlewares, devServer);
    }

    if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
      setupHealthEndpoints(devServer, healthPluginInstance);
    }

    return middlewares;
  };

  return devServerConfig;
};

module.exports = webpackConfig;

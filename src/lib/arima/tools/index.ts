/**
 * Single entrypoint for the ARIMA tools system.
 * Importing this file ensures all built-in tools are registered.
 */
import "./builtins";
import "./super-admin-tools";

export * from "./registry";

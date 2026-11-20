/*
 * Public API of the admin slice. Light: the store loads it on every page, so
 * it holds only the store wiring. The control center (uploads, transcoding,
 * sync metrics) is the route-level entry in ./routes.
 */
export { default as ingestionReducer } from "./model/ingestionSlice";
export { adminMediaApi } from "./api/adminMediaApi";

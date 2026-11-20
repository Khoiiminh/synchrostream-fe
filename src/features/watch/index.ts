/*
 * Public API of the watch slice: the movie player. Solo watching uses it as
 * is; a watch party renders it in party mode and hands it the party's sync
 * controller (createController), so this slice knows nothing about parties.
 */
export { default as WatchClientLeaf } from "./ui/WatchClientLeaf";

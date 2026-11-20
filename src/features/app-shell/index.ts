/*
 * Public API of the app shell: the header with navigation, the join-room
 * modal and the profile menu. Pages and the watch and watch-party slices wrap
 * their content in it. It is a slice, not shared UI, because it uses auth
 * (logout) and watch-party (room codes and passwords).
 */
export { default as NavbarWrapper } from "./ui/NavbarWrapper";

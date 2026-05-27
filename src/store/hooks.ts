import { useDispatch, useSelector } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './index';

/**
 * CUSTOM TYPESCRIPT HOOKS FOR REDUX STORE
 */

// Redux provides standard `useDispatch` and `useSelector` hooks, they don't know 
// what data in the specific store
// These lines create 'Typed' versions that understand the specific state (like `auth` slice) and specific actions

// A wrapper around the standard `useDispatch` hook
// The standard useDispatch doesn't know about middleware (like RTK Query). 
// By using useDispatch<AppDispatch>(), TypeScript will correctly suggest actions and 
// handle "Thunks" or "Mutations" without errors
// It acts as an messenger. When it is called, it returns the dispatch function configured specifically for the store

// It returns: The dispatch function.
// Sample: const dispatch = useAppDispatch();
export const useAppDispatch = () => useDispatch<AppDispatch>();

// A typed version of `useSelector`
// Without this, every time the `useSelector` is used, the state have to be manually typed
// (e.g., `(state: RootState) => state.auth`)
// This hook makes TypeScript knows that `state` is `RootState`

//It allows to "select" or "read" a specific piece of data from the store with full Autocomplete support.

//Whatever part of the state you requested.
// Sample: const token = useAppSelector((state) => state.auth.token); 
// (TypeScript will know state.auth exists and that token is a string).
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
// Directive and imports
// Redux relies on React Context, which is an interactive feature that only works on the client side.
// This tells the NextJS that this file needs to run in the browser
'use client';

import { Provider } from 'react-redux';
import { store } from './index';

// A standard React Component that takes `children` as a prop
// It uses TypeScript to define children as React.ReactNode, which basically means 
// "any valid JSX/HTML that sits inside this component."
// it returns a React component that wraps the app's layout
export function StoreProvider({ children }: { children: React.ReactNode }) {

  // By wrapping the `{children}` with `<Provider store={store}>`,
  // the Redux store is being made available to every single component nested inside it.
  return <Provider store={store}>{children}</Provider>;
}
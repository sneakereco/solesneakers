"use client";
import { createContext, useContext } from "react";
export const ViewGrant = createContext<string | null>(null);
export function useViewGrant() {
  return useContext(ViewGrant);
}

"use client";
import { createContext, useContext } from "react";
export const ViewGrant = createContext<string | null>(null);
export type CheckoutMeasurementPhase = "hydrating" | "off" | "ready";
export const CheckoutMeasurement = createContext<CheckoutMeasurementPhase>("off");
export function useCheckoutMeasurement() {
  return useContext(CheckoutMeasurement);
}
export function useViewGrant() {
  return useContext(ViewGrant);
}

export type Kind = "product" | "supply" | "service";

export interface Category {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  kind: Kind;
  unit: string;
  cost_usd: number | string;
  price_usd: number | string;
  stock: number | string;
  min_stock: number | string;
  taxable: boolean;
  track_inventory: boolean;
  active: boolean;
  category_id: string | null;
}

export interface Discount {
  id: string;
  name: string;
  code: string;
  kind: "percent" | "fixed";
  value: number | string;
  max_uses: number | null;
  used_count: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
}

export interface Surcharge {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number | string;
  charge_customer: boolean;
  active: boolean;
}

export interface PriceList {
  id: string;
  name: string;
  is_default: boolean;
  active: boolean;
}

export interface ProductPrice {
  product_id: string;
  price_list_id: string;
  price_usd: number | string;
}

export const KIND_LABEL: Record<Kind, string> = {
  product: "Para vender",
  supply: "Insumo",
  service: "Servicio",
};

export const KIND_SHORT: Record<Kind, string> = {
  product: "Simple",
  supply: "Insumo",
  service: "Servicio",
};

export const CATEGORY_COLORS = [
  "#4338ca",
  "#2563eb",
  "#7c3aed",
  "#312e81",
  "#059669",
  "#f59e0b",
  "#f97316",
  "#dc2626",
  "#64748b",
  "#ec4899",
];

export const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4338ca]";

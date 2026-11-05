import { describe, expect, it } from "vitest";

import { parseProductsCsv } from "./product-import";

const HEADER =
  "nombre;sku;codigo_barras;categoria;unidad;tipo;costo;precio;stock;stock_minimo;gravable;controla_inventario";

const CATEGORIES = [{ id: "cat-1", name: "Bebidas" }];

describe("parseProductsCsv", () => {
  it("lee números con coma decimal y asigna la categoría existente", () => {
    const result = parseProductsCsv(
      `${HEADER}\nCafé 250 g;CAFE-250;7591234567890;Bebidas;unidad;producto;2,50;5,00;12;4;si;si`,
      CATEGORIES,
      [],
    );

    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.name).toBe("Café 250 g");
    expect(row.cost).toBe(2.5);
    expect(row.price).toBe(5);
    expect(row.stock).toBe(12);
    expect(row.categoryId).toBe("cat-1");
    expect(row.taxable).toBe(true);
    expect(row.trackInventory).toBe(true);
    expect(row.error).toBeNull();
  });

  it("marca la fila sin nombre y la fila sin precio", () => {
    const result = parseProductsCsv(
      `${HEADER}\n;SIN-NOMBRE;;;;;;;5;;;;\nProducto sin precio;P-1;;;;;;;3;;;;`,
      CATEGORIES,
      [],
    );

    expect(result.rows[0].error).toBe("Falta el nombre");
    expect(result.rows[1].error).toBe("Falta el precio de venta");
  });

  it("detecta SKU repetido dentro del archivo y contra el catálogo", () => {
    const result = parseProductsCsv(
      `${HEADER}\nUno;SKU-1;;;;;;5;0;;;;\nDos;SKU-1;;;;;;5;0;;;;\nTres;SKU-2;;;;;;5;0;;;;`,
      CATEGORIES,
      [{ sku: "SKU-2", barcode: null }],
    );

    expect(result.rows[0].error).toBeNull();
    expect(result.rows[1].error).toBe("El SKU ya existe");
    expect(result.rows[2].error).toBe("El SKU ya existe");
  });

  it("acepta insumos sin precio y deja los servicios sin inventario", () => {
    const result = parseProductsCsv(
      `${HEADER}\nInsumo;I-1;;;;insumo;1,00;0;5;0;no;si\nInstalación;S-1;;;;servicio;0;15,00;9;0;no;si`,
      CATEGORIES,
      [],
    );

    expect(result.rows[0].error).toBeNull();
    expect(result.rows[1].kind).toBe("service");
    expect(result.rows[1].stock).toBe(0);
    expect(result.rows[1].trackInventory).toBe(false);
  });

  it("reporta la columna obligatoria que falta", () => {
    const result = parseProductsCsv("sku;precio\nA-1;5", CATEGORIES, []);
    expect(result.missingColumns).toEqual(["nombre"]);
  });
});

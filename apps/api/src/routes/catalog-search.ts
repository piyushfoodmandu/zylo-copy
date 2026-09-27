import type { AnyElysia } from "elysia";
import type { ProductDetailHandler } from "../product-detail-handler.ts";
import type { SearchHandler } from "../search-handler.ts";

type RegisterCatalogSearchRoutesOptions = {
  handleSearch: SearchHandler;
  handleProductDetail: ProductDetailHandler;
};

export const registerCatalogSearchRoutes = (
  app: AnyElysia,
  { handleSearch, handleProductDetail }: RegisterCatalogSearchRoutesOptions,
) => {
  app
    .post(
      "/v1/catalog/search",
      async ({ body, requestId, correlationId, set, requestTimeoutGuard }) =>
        requestTimeoutGuard.run(() =>
          handleSearch({
            body,
            requestId,
            correlationId,
            route: "/v1/catalog/search",
            set,
            requestTimeoutGuard,
          }),
        ),
    )
    .post(
      "/v1/catalog/product",
      async ({ body, requestId, correlationId, set, requestTimeoutGuard }) =>
        requestTimeoutGuard.run(() =>
          handleProductDetail({
            body,
            requestId,
            correlationId,
            route: "/v1/catalog/product",
            set,
            requestTimeoutGuard,
          }),
        ),
    );
};

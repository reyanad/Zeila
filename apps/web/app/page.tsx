import { DEFAULT_PLATFORM_FEE_BPS, formatMoney } from "@marketplace/shared-types";

export default function HomePage() {
  const exampleFee = formatMoney({ amount: DEFAULT_PLATFORM_FEE_BPS, currency: "USD" });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: 640, margin: "0 auto" }}>
      <h1>Marketplace</h1>
      <p>
        Phase 1 foundation is running: monorepo, database schema, and shared packages. Storefront UI
        arrives in Phase 4.
      </p>
      <p style={{ color: "#666", fontSize: 14 }}>
        Wiring check: shared money helper renders {exampleFee} from 500 minor units.
      </p>
    </main>
  );
}

import os
import sqlite3
import pandas as pd
import yfinance as yf

# Standard Indian Market Financial Constants (INR / Crores)
# 1 Crore (Cr) = 10,000,000 INR = 10^7 INR
CRORE_IN_INR = 10_000_000

MIN_MARKET_CAP = 500 * CRORE_IN_INR        # ₹500 Cr (Excludes Micro-Cap)
MID_CAP_THRESHOLD = 5_000 * CRORE_IN_INR   # ₹5,000 Cr
LARGE_CAP_THRESHOLD = 20_000 * CRORE_IN_INR # ₹20,000 Cr
MIN_PRICE = 20.00                           # ₹20.00 (Excludes Penny Stocks)
MIN_VOLUME = 100_000                       # 100,000 shares (Liquidity Filter)


class StockScreener:
    """
    Financial Data Screening & Tracking Engine localized for the Indian Stock Market (NSE / BSE).
    Filters stocks by Market Cap (₹ Cr), Price (₹), and Liquidity thresholds while categorizing retained equities.
    """

    def fetch_stock_data(self, tickers: list[str]) -> pd.DataFrame:
        """
        Fetch market data for Indian tickers (.NS / .BO) using yfinance batch lookup.
        Handles missing fields gracefully.
        """
        records = []
        print(f"Fetching market data for {len(tickers)} Indian tickers (NSE/BSE)...")

        # Batch lookup for speed
        tickers_str = " ".join(tickers)
        batch_tickers = yf.Tickers(tickers_str)

        for ticker in tickers:
            t_symbol = ticker.upper().strip()
            try:
                t_obj = batch_tickers.tickers.get(t_symbol) or yf.Ticker(t_symbol)
                info = t_obj.info or {}

                # Extract metrics with fallbacks
                name = info.get("shortName") or info.get("longName") or t_symbol
                price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
                market_cap = info.get("marketCap")
                volume = info.get("averageVolume") or info.get("averageDailyVolume10Day") or info.get("volume")
                sector = info.get("sector") or info.get("industry") or "N/A"

                records.append({
                    "Ticker": t_symbol,
                    "Name": name,
                    "Price": price,
                    "MarketCap": market_cap,
                    "Volume": volume,
                    "Sector": sector
                })
            except Exception as e:
                print(f"Warning: Failed to fetch data for {t_symbol}: {e}")
                records.append({
                    "Ticker": t_symbol,
                    "Name": t_symbol,
                    "Price": None,
                    "MarketCap": None,
                    "Volume": None,
                    "Sector": "N/A"
                })

        return pd.DataFrame(records)

    def categorize_cap(self, market_cap: float) -> str:
        """Categorize Market Cap into Large-Cap, Mid-Cap, or Small-Cap based on SEBI/Indian thresholds."""
        if pd.isna(market_cap):
            return "Unknown"
        if market_cap >= LARGE_CAP_THRESHOLD:
            return "Large-Cap"
        elif market_cap >= MID_CAP_THRESHOLD:
            return "Mid-Cap"
        elif market_cap >= MIN_MARKET_CAP:
            return "Small-Cap"
        else:
            return "Micro-Cap"

    def apply_filters(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Applies Indian Market business logic filtering rules:
        1. Drop rows missing MarketCap, Price, or Volume.
        2. Exclude Micro-Cap stocks (MarketCap < ₹500 Cr).
        3. Exclude Penny stocks (Price < ₹20.00).
        4. Exclude Low-Volume stocks (Volume < 100,000 shares).
        5. Add Capitalization Category column.
        """
        if df.empty:
            return pd.DataFrame()

        # Step 1: Handle missing data gracefully by dropping incomplete rows
        clean_df = df.dropna(subset=["Price", "MarketCap", "Volume"]).copy()

        # Ensure numeric types
        clean_df["Price"] = pd.to_numeric(clean_df["Price"], errors="coerce")
        clean_df["MarketCap"] = pd.to_numeric(clean_df["MarketCap"], errors="coerce")
        clean_df["Volume"] = pd.to_numeric(clean_df["Volume"], errors="coerce")
        clean_df = clean_df.dropna(subset=["Price", "MarketCap", "Volume"])

        # Step 2: Apply Indian market threshold filters
        filtered_df = clean_df[
            (clean_df["MarketCap"] >= MIN_MARKET_CAP) &
            (clean_df["Price"] >= MIN_PRICE) &
            (clean_df["Volume"] >= MIN_VOLUME)
        ].copy()

        # Step 3: Assign Capitalization Category
        filtered_df["Category"] = filtered_df["MarketCap"].apply(self.categorize_cap)

        # Sort descending by Market Cap
        filtered_df.sort_values(by="MarketCap", ascending=False, inplace=True)
        filtered_df.reset_index(drop=True, inplace=True)

        return filtered_df

    def export_to_csv(self, df: pd.DataFrame, filename: str = "filtered_stocks.csv") -> str:
        """Export filtered DataFrame to CSV file."""
        df.to_csv(filename, index=False)
        print(f"Exported {len(df)} rows to CSV: {filename}")
        return filename

    def export_to_sqlite(self, df: pd.DataFrame, db_name: str = "stocks.db", table_name: str = "screened_stocks") -> str:
        """Export filtered DataFrame to SQLite database."""
        conn = sqlite3.connect(db_name)
        df.to_sql(table_name, conn, if_exists="replace", index=False)
        conn.close()
        print(f"Exported {len(df)} rows to SQLite Database '{db_name}' -> Table '{table_name}'")
        return db_name


def main():
    # Sample list of 30 mixed Indian NSE/BSE tickers
    sample_tickers = [
        # Large-Cap (> ₹20,000 Cr)
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS",
        "BHARTIARTL.NS", "ITC.NS", "SBIN.NS", "LT.NS", "HINDUNILVR.NS",
        # Mid-Cap (₹5,000 Cr – ₹20,000 Cr)
        "GICRE.NS", "PANAMAPET.NS", "BATAINDIA.NS", "POLYCAB.NS", "COFORGE.NS",
        "PERSISTENT.NS", "APOLLOTYRE.NS", "NATIONALUM.NS",
        # Small-Cap (₹500 Cr – ₹5,000 Cr)
        "RCF.NS", "NFL.NS", "SPIC.NS", "DCBBANK.NS", "SOUTHBANK.NS",
        # Micro-Cap (< ₹500 Cr)
        "MPAGI.BO", "SGL.NS", "ALOKINDS.NS",
        # Penny Stocks (< ₹20.00)
        "JPPOWER.NS", "RTNPOWER.NS", "IDEA.NS", "VIKASLIFE.NS"
    ]

    screener = StockScreener()

    # 1. Fetch
    raw_df = screener.fetch_stock_data(sample_tickers)
    print(f"\nFetched Data Summary: Total Rows = {len(raw_df)}")

    # 2. Filter
    filtered_df = screener.apply_filters(raw_df)
    print(f"\nFiltered Data Summary: Retained Rows = {len(filtered_df)}")

    # Display clean formatted table output
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 1000)

    print("\n" + "=" * 95)
    print("                 INDIAN MARKET (NSE/BSE) CLEAN SCREENED RESULTS                 ")
    print("=" * 95)

    # Format display columns cleanly in INR (₹) and Crores (₹ Cr)
    display_df = filtered_df.copy()
    display_df["MarketCap (₹ Cr)"] = display_df["MarketCap"].apply(
        lambda x: f"₹{x / CRORE_IN_INR:,.2f} Cr"
    )
    display_df["Price (₹)"] = display_df["Price"].apply(lambda x: f"₹{x:,.2f}")
    display_df["Volume"] = display_df["Volume"].apply(lambda x: f"{x:,.0f}")

    columns_to_show = ["Ticker", "Name", "Category", "Price (₹)", "MarketCap (₹ Cr)", "Volume", "Sector"]
    print(display_df[columns_to_show].to_string(index=False))
    print("=" * 95 + "\n")

    # 3. Export
    screener.export_to_csv(filtered_df, "filtered_stocks.csv")
    screener.export_to_sqlite(filtered_df, "stocks.db", "screened_stocks")


if __name__ == "__main__":
    main()

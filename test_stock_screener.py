import pytest
import pandas as pd
from stock_screener import StockScreener, CRORE_IN_INR


@pytest.fixture
def mock_indian_stock_data():
    """Create a synthetic mock DataFrame covering Indian Market edge cases and thresholds."""
    return pd.DataFrame([
        # 1. Micro-Cap Exclusion Test (₹250 Cr < ₹500 Cr)
        {
            "Ticker": "MICRO.NS",
            "Name": "MicroCap India Ltd",
            "Price": 50.00,
            "MarketCap": 250 * CRORE_IN_INR,   # ₹250 Cr
            "Volume": 500_000,
            "Sector": "Technology"
        },
        # 2. Penny Stock Exclusion Test (₹15.00 < ₹20.00)
        {
            "Ticker": "PENNY.NS",
            "Name": "Penny Power Ltd",
            "Price": 15.00,                     # ₹15.00 < ₹20.00
            "MarketCap": 1_000 * CRORE_IN_INR,  # ₹1,000 Cr
            "Volume": 500_000,
            "Sector": "Utilities"
        },
        # 3. Small-Cap Retention Test (₹1,000 Cr Market Cap @ ₹50.00 Price, 500k Volume)
        {
            "Ticker": "SMALL.NS",
            "Name": "SmallCap India Corp",
            "Price": 50.00,
            "MarketCap": 1_000 * CRORE_IN_INR,  # ₹1,000 Cr
            "Volume": 500_000,
            "Sector": "Chemicals"
        },
        # 4. Mid-Cap Retention Test (₹10,000 Cr Market Cap @ ₹200.00 Price)
        {
            "Ticker": "MID.NS",
            "Name": "MidCap Systems India",
            "Price": 200.00,
            "MarketCap": 10_000 * CRORE_IN_INR, # ₹10,000 Cr
            "Volume": 1_000_000,
            "Sector": "Auto Ancillaries"
        },
        # 5. Large-Cap Retention Test (₹100,000 Cr Market Cap @ ₹1,500.00 Price)
        {
            "Ticker": "LARGE.NS",
            "Name": "LargeCap Tech India",
            "Price": 1500.00,
            "MarketCap": 100_000 * CRORE_IN_INR, # ₹100,000 Cr
            "Volume": 5_000_000,
            "Sector": "IT Services"
        },
        # 6. Low Volume Exclusion Test (< 100k shares)
        {
            "Ticker": "LOWVOL.NS",
            "Name": "Low Volume Equities",
            "Price": 100.00,
            "MarketCap": 2_000 * CRORE_IN_INR,   # ₹2,000 Cr
            "Volume": 50_000,                    # 50k < 100k
            "Sector": "Textiles"
        },
        # 7. Missing Data Handling Test (NaN values)
        {
            "Ticker": "MISSING.NS",
            "Name": "Missing Data Ltd",
            "Price": None,
            "MarketCap": float("nan"),
            "Volume": 500_000,
            "Sector": "N/A"
        }
    ])


def test_indian_stock_filters_and_categories(mock_indian_stock_data):
    screener = StockScreener()
    filtered_df = screener.apply_filters(mock_indian_stock_data)

    retained_tickers = set(filtered_df["Ticker"].tolist())

    # Assertions for Exclusions
    assert "MICRO.NS" not in retained_tickers, "Failure: ₹250 Cr Micro-Cap stock was not filtered out."
    assert "PENNY.NS" not in retained_tickers, "Failure: ₹15.00 Penny stock was not filtered out."
    assert "LOWVOL.NS" not in retained_tickers, "Failure: Low volume (<100k) stock was not filtered out."
    assert "MISSING.NS" not in retained_tickers, "Failure: NaN missing data row was not filtered out."

    # Assertions for Retained Stocks
    assert "SMALL.NS" in retained_tickers, "Failure: ₹1,000 Cr Small-Cap stock @ ₹50.00 was not retained."
    assert "MID.NS" in retained_tickers, "Failure: ₹10,000 Cr Mid-Cap stock was not retained."
    assert "LARGE.NS" in retained_tickers, "Failure: ₹100,000 Cr Large-Cap stock was not retained."

    # Check Total Retained Count
    assert len(filtered_df) == 3, f"Expected exactly 3 retained stocks, got {len(filtered_df)}"

    # Check Categorization Labels
    small_row = filtered_df[filtered_df["Ticker"] == "SMALL.NS"].iloc[0]
    mid_row = filtered_df[filtered_df["Ticker"] == "MID.NS"].iloc[0]
    large_row = filtered_df[filtered_df["Ticker"] == "LARGE.NS"].iloc[0]

    assert small_row["Category"] == "Small-Cap", f"Expected Small-Cap, got {small_row['Category']}"
    assert mid_row["Category"] == "Mid-Cap", f"Expected Mid-Cap, got {mid_row['Category']}"
    assert large_row["Category"] == "Large-Cap", f"Expected Large-Cap, got {large_row['Category']}"


def test_categorize_cap_indian():
    screener = StockScreener()
    assert screener.categorize_cap(50_000 * CRORE_IN_INR) == "Large-Cap"  # ₹50,000 Cr >= ₹20,000 Cr
    assert screener.categorize_cap(10_000 * CRORE_IN_INR) == "Mid-Cap"    # ₹10,000 Cr (₹5k–₹20k Cr)
    assert screener.categorize_cap(1_000 * CRORE_IN_INR) == "Small-Cap"   # ₹1,000 Cr (₹500–₹5k Cr)
    assert screener.categorize_cap(300 * CRORE_IN_INR) == "Micro-Cap"     # ₹300 Cr < ₹500 Cr

# Google Maps Billing Error Fix

## Problem
You're seeing this error: "This page can't load Google Maps correctly" with `BillingNotEnabledMapError`.

## Solution
Enable billing for your Google Maps API key:

### Step 1: Go to Google Cloud Console
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (the one with your Maps API key)

### Step 2: Enable Billing
1. Go to **Billing** in the left sidebar
2. Click **Link a billing account** or **Manage billing accounts**
3. Create a new billing account or link an existing one
4. Add a payment method (credit card)

### Step 3: Enable Required APIs
1. Go to **APIs & Services** > **Library**
2. Search for and enable these APIs:
   - **Maps JavaScript API**
   - **Drawing Library** (for polygon drawing)
   - **Marker Library** (for custom markers)

### Step 4: Verify API Key
1. Go to **APIs & Services** > **Credentials**
2. Check that your API key has the correct restrictions
3. Make sure it's enabled for the APIs you're using

## Cost Information
- Google Maps has a generous free tier
- First $200 of usage per month is free
- For typical usage, you likely won't exceed the free tier
- See [Google Maps Pricing](https://developers.google.com/maps/billing-and-pricing) for details

## Fallback
The app now includes error handling, so if billing isn't enabled, users will see a helpful message instead of a broken map.

## Testing
After enabling billing, refresh your app and the map should load correctly with all features working.

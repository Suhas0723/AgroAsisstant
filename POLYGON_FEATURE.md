# Polygon Drawing Feature for Plots

## Overview
Updated the plots page to support diagonal/rotated plot shapes using Google Maps Polygon drawing instead of rectangles.

## Changes Made

### Frontend (templates/plots.html)
1. **Drawing Manager**: Changed from `RECTANGLE` to `POLYGON` mode
2. **Event Handling**: Updated to handle polygon completion events
3. **Data Storage**: Added polygon path coordinates to form data
4. **Display Logic**: Added support for both rectangle (legacy) and polygon display
5. **User Instructions**: Added helpful text explaining how to draw polygons

### Backend (app.py)
1. **Data Handling**: Added `polygon_path` parameter to `/plots` POST route
2. **Database Storage**: Store polygon coordinates as JSON in Firestore
3. **Backward Compatibility**: Existing rectangle plots still work

## How to Use

### Drawing a Polygon Plot
1. Click the polygon tool in the drawing controls
2. Click on the map to add points for your plot boundary
3. Double-click to finish the polygon
4. Click "Save" to save the plot with crop information

### Features
- **Diagonal Plots**: Draw plots at any angle/orientation
- **Editable**: Polygons can be edited after creation
- **Draggable**: Move entire plots by dragging
- **Backward Compatible**: Existing rectangle plots still display correctly
- **Area Calculation**: Automatic area calculation for both shapes

## Technical Details

### Data Structure
```javascript
// Polygon coordinates stored as array of objects (Firestore-compatible)
polygon_path: [
  {lat: lat1, lng: lng1},
  {lat: lat2, lng: lng2},
  {lat: lat3, lng: lng3},
  // ... more points
]
```

### Database Schema
- `polygon_path`: Array of coordinate objects `{lat: number, lng: number}` (optional, for new plots)
- `sw_lat`, `sw_long`, `ne_lat`, `ne_long`: Bounding box (for area calculation)
- All other fields remain the same

## Benefits
- More accurate plot representation
- Better for irregular field shapes
- Maintains existing functionality
- Easy to use interface

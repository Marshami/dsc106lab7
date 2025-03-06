////////////////////////////////////////////////////////////////////////////////
// 1) Import ES modules for Mapbox + D3
////////////////////////////////////////////////////////////////////////////////
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

////////////////////////////////////////////////////////////////////////////////
// 2) Initialize Mapbox
//    (Using your provided token — if you want privacy, replace this with a placeholder)
////////////////////////////////////////////////////////////////////////////////
mapboxgl.accessToken =
  'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston area
  zoom: 12
});

// Wait for map to finish loading
map.on('load', onMapLoad);

////////////////////////////////////////////////////////////////////////////////
// 3) Main logic after map loads
////////////////////////////////////////////////////////////////////////////////
async function onMapLoad() {
  // --------------------------------------------------------------------------
  // A) Add Boston & Cambridge bike lanes as line layers
  // --------------------------------------------------------------------------
  map.addSource('boston_lanes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_lanes',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  map.addSource('cambridge_lanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_lanes',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  // --------------------------------------------------------------------------
  // B) Load station & traffic data
  // --------------------------------------------------------------------------
  // DSC106 station JSON has: { "Number": "A32000", "NAME": "...", "Lat": 42.1234, "Long": -71.1234, ... }
  const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = stationData.data.stations; // array

  // Large CSV: 260k rows
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    row => {
      row.started_at = new Date(row.started_at);
      row.ended_at   = new Date(row.ended_at);
      return row;
    }
  );

  // --------------------------------------------------------------------------
  // C) Create an SVG overlay to show circles for each station
  // --------------------------------------------------------------------------
  const svg = d3.select('#map').select('svg');

  // Bind station data => circles
  // Use station.Number as key (since that matches trip's start_station_id / end_station_id)
  const circles = svg.selectAll('circle')
    .data(stations, d => d.Number)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'gray')   // we update color in updateScatterPlot
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.7);

  // Project lat/lon => pixel coords
  function projectCoords(station) {
    const lon = +station.Long; // capital L per DSC106 dataset
    const lat = +station.Lat;  // capital L for Lat
    const point = map.project([lon, lat]);
    return [point.x, point.y];
  }

  // Keep circles in sync with map panning
  function updatePositions() {
    circles
      .attr('cx', d => projectCoords(d)[0])
      .attr('cy', d => projectCoords(d)[1]);
  }
  // Do initial position + listen for map changes
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // --------------------------------------------------------------------------
  // D) Helper functions to compute arrivals/departures & filter by time
  // --------------------------------------------------------------------------
  function computeStationTraffic(stations, tripData) {
    // Tally total departures by station ID
    const departuresMap = d3.rollup(
      tripData,
      v => v.length,
      d => d.start_station_id
    );
    // Tally total arrivals by station ID
    const arrivalsMap = d3.rollup(
      tripData,
      v => v.length,
      d => d.end_station_id
    );

    // Attach arrivals, departures, totalTraffic to each station
    return stations.map(station => {
      const sid = station.Number; // e.g. "A32000"
      const dep = departuresMap.get(sid) || 0;
      const arr = arrivalsMap.get(sid)   || 0;
      station.departures   = dep;
      station.arrivals     = arr;
      station.totalTraffic = dep + arr;
      return station;
    });
  }

  function filterTripsByTime(tripData, timeVal) {
    if (timeVal === -1) {
      // no filtering => all trips
      return tripData;
    }
    return tripData.filter(t => {
      const startM = minutesSinceMidnight(t.started_at);
      const endM   = minutesSinceMidnight(t.ended_at);
      // keep if start or end is within 60 min
      return (
        Math.abs(startM - timeVal) <= 60 ||
        Math.abs(endM - timeVal)   <= 60
      );
    });
  }

  function minutesSinceMidnight(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  // Sqrt scale for circle radius
  const radiusScale = d3.scaleSqrt()
    .range([0, 25]); // domain set dynamically

  // 3 discrete color bins for ratio of departures to total
  const colorScale = d3.scaleQuantize()
    .domain([0, 1]) // 0 => all arrivals, 1 => all departures
    .range(['orange','purple','steelblue']); // more arrivals, balanced, more dep

  // --------------------------------------------------------------------------
  // E) Update circles when slider changes
  // --------------------------------------------------------------------------
  function updateScatterPlot(timeVal) {
    // Filter trip data for ±60 minutes
    const filtered = filterTripsByTime(trips, timeVal);

    // Recompute arrivals/departures for each station
    const updatedStations = computeStationTraffic(stations, filtered);

    // Adjust radius scale domain
    const maxTraffic = d3.max(updatedStations, d => d.totalTraffic) || 1;
    if (timeVal === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]); // bigger if user filters
    }
    radiusScale.domain([0, maxTraffic]);

    circles
      .data(updatedStations, d => d.Number)
      .join('circle') // ensure we keep existing circles
      .transition()
      .duration(300)
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', d => {
        if (d.totalTraffic === 0) {
          return 'gray'; // station with no trips in this filter
        }
        const ratio = d.departures / d.totalTraffic; // 0..1
        return colorScale(ratio);
      });

    // Add or update <title> for a tooltip
    circles.each(function(d){
      d3.select(this).selectAll('title').remove();
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
    });
  }

  // --------------------------------------------------------------------------
  // F) Hook the slider to updateScatterPlot
  // --------------------------------------------------------------------------
  const slider      = document.getElementById('time-slider');
  const selectedTim = document.getElementById('selected-time');
  const anyTimeLbl  = document.getElementById('any-time');

  slider.addEventListener('input', onTimeChange);
  onTimeChange(); // init

  function onTimeChange() {
    const val = +slider.value;
    if (val === -1) {
      selectedTim.textContent = '';
      anyTimeLbl.style.display = 'inline';
    } else {
      selectedTim.textContent = formatTime(val);
      anyTimeLbl.style.display = 'none';
    }
    // Recompute & redraw
    updateScatterPlot(val);
  }

  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
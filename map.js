////////////////////////////////////////////////////////////////////////////////
// 1) Import ES Modules for Mapbox + D3
////////////////////////////////////////////////////////////////////////////////
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

////////////////////////////////////////////////////////////////////////////////
// 2) Initialize Mapbox (replace with your real token!)
////////////////////////////////////////////////////////////////////////////////
mapboxgl.accessToken = 'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston
  zoom: 12
});

// Wait for map to load
map.on('load', onMapLoad);

////////////////////////////////////////////////////////////////////////////////
// 3) Main logic: Bike lanes, stations, circles sized & colored, time filter
////////////////////////////////////////////////////////////////////////////////
async function onMapLoad() {
  // --------------------------------------------------------------------------
  // A) Add Boston + Cambridge bike lanes as "line" layers
  // --------------------------------------------------------------------------
  map.addSource('boston_lines', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'boston-lanes',
    type: 'line',
    source: 'boston_lines',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  map.addSource('cambridge_lines', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'cambridge-lanes',
    type: 'line',
    source: 'cambridge_lines',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  // --------------------------------------------------------------------------
  // B) Fetch station + traffic data
  // --------------------------------------------------------------------------
  // 1) Station data (JSON)
  const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = stationData.data.stations;

  // 2) Traffic data (CSV, ~260K rows)
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    row => {
      // Convert times to Date
      row.started_at = new Date(row.started_at);
      row.ended_at   = new Date(row.ended_at);
      return row;
    }
  );

  // --------------------------------------------------------------------------
  // C) Create an SVG overlay for station circles
  // --------------------------------------------------------------------------
  const svg = d3.select('#map').select('svg');

  // Bind data => circles
  const circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'gray')  // temporary, will set actual color later
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.75);

  // A helper to project station lat/lon to pixel coords
  function projectCoords(station) {
    // depends on station fields: "Lat"/"Long" in the JSON
    const lon = +station.Long;
    const lat = +station.Lat;
    const pt = map.project([lon, lat]);
    return [pt.x, pt.y];
  }

  function updatePositions() {
    circles
      .attr('cx', d => projectCoords(d)[0])
      .attr('cy', d => projectCoords(d)[1]);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // --------------------------------------------------------------------------
  // D) Utilities to compute arrivals/departures + filter by time
  // --------------------------------------------------------------------------
  function computeStationTraffic(stations, tripData) {
    // Tally total departures
    const depMap = d3.rollup(
      tripData,
      v => v.length,
      d => d.start_station_id
    );
    // Tally total arrivals
    const arrMap = d3.rollup(
      tripData,
      v => v.length,
      d => d.end_station_id
    );
    // Attach arrivals, departures, totalTraffic
    return stations.map(station => {
      const sid = station.short_name; // e.g. "A32000"
      const dep = depMap.get(sid) || 0;
      const arr = arrMap.get(sid) || 0;
      station.departures = dep;
      station.arrivals   = arr;
      station.totalTraffic = dep + arr;
      return station;
    });
  }

  function filterTripsByTime(tripData, timeVal) {
    if (timeVal === -1) {
      // no filtering
      return tripData;
    }
    // keep only trips that started/ended within 60 min of timeVal
    return tripData.filter(t => {
      const startM = minutesSinceMidnight(t.started_at);
      const endM   = minutesSinceMidnight(t.ended_at);
      return (
        Math.abs(startM - timeVal) <= 60 ||
        Math.abs(endM   - timeVal) <= 60
      );
    });
  }

  function minutesSinceMidnight(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  // For circle radius, use a sqrt scale
  const radiusScale = d3.scaleSqrt()
    .range([0, 25]); // we’ll set domain dynamically

  // For circle color, we define a 3-bin quantize scale: 0 => arrivals, 0.5 => balanced, 1 => departures
  const colorScale = d3.scaleQuantize()
    .domain([0, 1])
    .range(['orange','purple','steelblue']);

  // --------------------------------------------------------------------------
  // E) Update the circles after user picks a time
  // --------------------------------------------------------------------------
  function updateScatterPlot(timeVal) {
    // 1) Filter trips
    const filteredTrips = filterTripsByTime(trips, timeVal);

    // 2) Recompute station arrivals/departures
    const updatedStations = computeStationTraffic(stations, filteredTrips);

    // 3) Adjust domain for circle radius
    const maxTraffic = d3.max(updatedStations, d => d.totalTraffic) || 1;
    // If user picks a narrower time, we can scale circles up
    if (timeVal === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }
    radiusScale.domain([0, maxTraffic]);

    // 4) Update circles: radius + color
    circles
      .data(updatedStations, d => d.short_name)
      .join('circle') // ensure we reuse existing circles
      .transition()
      .duration(250)
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', d => {
        if (d.totalTraffic === 0) {
          return 'gray'; // no traffic => no data
        }
        const ratio = d.departures / d.totalTraffic; // 0..1
        return colorScale(ratio);
      });

    // 5) Add or update <title> for tooltip
    circles.each(function(d){
      const sel = d3.select(this);
      sel.selectAll('title').remove();
      sel.append('title')
        .text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
    });
  }

  // --------------------------------------------------------------------------
  // F) Time slider: hooking up to updateScatterPlot
  // --------------------------------------------------------------------------
  const timeSlider   = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTime      = document.getElementById('any-time');

  timeSlider.addEventListener('input', onTimeChange);
  onTimeChange(); // init

  function onTimeChange() {
    const val = +timeSlider.value;
    if (val === -1) {
      selectedTime.textContent = '';
      anyTime.style.display = 'inline';
    } else {
      selectedTime.textContent = formatTime(val);
      anyTime.style.display = 'none';
    }
    // filter + redraw
    updateScatterPlot(val);
  }

  function formatTime(minutes) {
    const date = new Date(0,0,0,0, minutes);
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
}

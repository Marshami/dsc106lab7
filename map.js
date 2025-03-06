////////////////////////////////////////////////////////////////////////////////
// 1) Import ES Modules for Mapbox and D3
////////////////////////////////////////////////////////////////////////////////
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

////////////////////////////////////////////////////////////////////////////////
// 2) Initialize Mapbox (replace token with yours!)
////////////////////////////////////////////////////////////////////////////////
mapboxgl.accessToken = 'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng'; // <= PUT YOUR TOKEN HERE!

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston
  zoom: 12
});

////////////////////////////////////////////////////////////////////////////////
// 3) Wait until map loads, then do everything else
////////////////////////////////////////////////////////////////////////////////
map.on('load', async () => {
  // --------------------------------------------------------------------------
  // (A) ADD LAYERS FOR BOSTON & CAMBRIDGE BIKE LANES
  // --------------------------------------------------------------------------
  map.addSource('boston_routes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_routes',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  map.addSource('cambridge_routes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_routes',
    paint: {
      'line-color': 'orange',
      'line-width': 3,
      'line-opacity': 0.5
    }
  });

  // --------------------------------------------------------------------------
  // (B) LOAD STATIONS + TRAFFIC DATA
  // --------------------------------------------------------------------------
  // 1) Station Info (JSON)
  const stationJSON = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = stationJSON.data.stations;

  // 2) Traffic Info (CSV) => quite large (260k rows)
  let trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', row => {
    // Convert the started_at/ended_at to Date objects
    row.started_at = new Date(row.started_at);
    row.ended_at = new Date(row.ended_at);
    return row;
  });

  // --------------------------------------------------------------------------
  // (C) CREATE THE SVG OVERLAY FOR STATION MARKERS
  // --------------------------------------------------------------------------
  const svg = d3.select('#map').select('svg');

  // We'll create circles for each station, keyed by short_name
  const circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.7);

  // Helper: project lat/lon to pixel coords
  function projectCoords(station) {
    // The dataset uses "Lat"/"Long", so check your JSON carefully
    const lon = +station.Long;
    const lat = +station.Lat;
    const pt = map.project([lon, lat]);
    return [pt.x, pt.y];
  }

  // Update circle positions whenever the map moves/zooms
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
  // (D) CREATE A HELPER TO COMPUTE STATION TRAFFIC
  //     given a filtered trip set or timeFilter
  // --------------------------------------------------------------------------
  function computeStationTraffic(stations, tripData) {
    // 1) Tally departures
    const dep = d3.rollup(
      tripData,
      v => v.length,
      d => d.start_station_id
    );

    // 2) Tally arrivals
    const arr = d3.rollup(
      tripData,
      v => v.length,
      d => d.end_station_id
    );

    // 3) Attach arrivals/departures/totalTraffic to each station
    return stations.map(station => {
      const sid = station.short_name; // e.g. "A32001"
      const departures = dep.get(sid) || 0;
      const arrivals = arr.get(sid) || 0;
      station.departures = departures;
      station.arrivals = arrivals;
      station.totalTraffic = departures + arrivals;
      return station;
    });
  }

  // We want to do time-based filtering. The user can pick a time “t” => we only consider
  // trips that started or ended within 60 minutes of “t” (by the instructions).
  function filterTripsByTime(tripData, t) {
    if (t === -1) {
      // -1 means "any time"
      return tripData;
    } else {
      return tripData.filter(trip => {
        const startMin = minutesSinceMidnight(trip.started_at);
        const endMin = minutesSinceMidnight(trip.ended_at);
        // keep if within 60 min from selected time
        return (
          Math.abs(startMin - t) <= 60 ||
          Math.abs(endMin - t) <= 60
        );
      });
    }
  }

  // Convert a Date to "minutes since midnight"
  function minutesSinceMidnight(dt) {
    return dt.getHours() * 60 + dt.getMinutes();
  }

  // We'll create a sqrt scale for circle radius
  const radiusScale = d3.scaleSqrt().range([0, 25]);

  // --------------------------------------------------------------------------
  // (E) CREATE A FUNCTION TO UPDATE THE MARKERS AFTER FILTERING
  // --------------------------------------------------------------------------
  function updateScatterPlot(timeFilter) {
    // 1) Filter trips
    const filtered = filterTripsByTime(trips, timeFilter);

    // 2) Recompute station traffic
    const updatedStations = computeStationTraffic(stations, filtered);

    // 3) Recompute domain for radius scale
    const maxTraffic = d3.max(updatedStations, d => d.totalTraffic) || 1;
    // If user filters to a small subset, you might want bigger circles,
    // so let's do a conditional range:
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]); // bigger if filtered
    }
    radiusScale.domain([0, maxTraffic]);

    // 4) Update existing circles
    circles.data(updatedStations, d => d.short_name)
      .join('circle') // ensure we have the same set of circles
      .transition()
      .duration(300)
      .attr('r', d => radiusScale(d.totalTraffic));

    // 5) Optionally update a tooltip <title>
    circles.each(function (d) {
      d3.select(this)
        .selectAll('title')
        .remove(); // remove old tooltip if present

      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });
  }

  // --------------------------------------------------------------------------
  // (F) HANDLE THE TIME SLIDER
  // --------------------------------------------------------------------------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Format the selected slider value
  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    // 'en-US' with hour:minute => "1:05 PM"
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function onSliderChange() {
    const val = +timeSlider.value; // convert string to number
    if (val === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'inline';
    } else {
      selectedTime.textContent = formatTime(val);
      anyTimeLabel.style.display = 'none';
    }
    // Recompute & redraw station circles
    updateScatterPlot(val);
  }

  // Listen for changes
  timeSlider.addEventListener('input', onSliderChange);

  // Initialize
  onSliderChange(); // Start with "any time" => all data
});
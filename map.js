////////////////////////////////////////////////////////////////////////////////
// 1) Mapbox Setup
////////////////////////////////////////////////////////////////////////////////
mapboxgl.accessToken =
  'pk.eyJ1Ijoia2VzZW5udW1hIiwiYSI6ImNtN3d3ZTM1eTBhY2MybW9xczNycWFncmwifQ.XARtRgsunDu3KIil4VoCng';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// We'll overlay an SVG on the map for station circles
const svg = d3.select('#map').select('svg');

////////////////////////////////////////////////////////////////////////////////
// 2) Variables: Data, slider references, etc.
////////////////////////////////////////////////////////////////////////////////
let stations = [];
let trips = [];
let timeFilter = -1;

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

// We'll define a function that updates circles after each slider change
let updateScatterPlotFn = null;

////////////////////////////////////////////////////////////////////////////////
// 3) Utility Functions
////////////////////////////////////////////////////////////////////////////////
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(tripData, timeVal) {
  if (timeVal === -1) {
    // No filter
    return tripData;
  }
  return tripData.filter(trip => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes   = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(startedMinutes - timeVal) <= 60 ||
      Math.abs(endedMinutes   - timeVal) <= 60
    );
  });
}

function computeStationTraffic(stations, tripData) {
  // Tally departures for each station
  const departures = d3.rollup(
    tripData,
    v => v.length,
    d => d.start_station_id
  );

  // Tally arrivals for each station
  const arrivals = d3.rollup(
    tripData,
    v => v.length,
    d => d.end_station_id
  );

  // Attach arrivals, departures, totalTraffic
  return stations.map(station => {
    const sid = station.short_name;
    const dep = departures.get(sid) || 0;
    const arr = arrivals.get(sid)   || 0;
    return {
      ...station,
      departures: dep,
      arrivals: arr,
      totalTraffic: dep + arr
    };
  });
}

// For each station, convert lat/lon => pixel coords for the map's current view
function getCoords(station) {
  // NOTE: In DSC106 data, some use station.lat/lon or station.Lat/Long.
  // Make sure you match what the data actually has!
  // This code expects station.lon, station.lat
  const lngLat = new mapboxgl.LngLat(+station.lon, +station.lat);
  const point = map.project(lngLat);
  return { cx: point.x, cy: point.y };
}

////////////////////////////////////////////////////////////////////////////////
// 4) Discrete Color Scale for Circle Fill
////////////////////////////////////////////////////////////////////////////////
// ratio = departures / totalTraffic
// 0 => all arrivals, 1 => all departures
const colorScale = d3.scaleQuantize()
  .domain([0, 1])
  .range(['orange', 'purple', 'steelblue']);
// Feel free to re-order: ['steelblue','purple','orange'] => departures → balanced → arrivals

////////////////////////////////////////////////////////////////////////////////
// 5) Time Slider Event
////////////////////////////////////////////////////////////////////////////////
function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  // If we've defined the update function, call it
  if (updateScatterPlotFn) {
    updateScatterPlotFn(timeFilter);
  }
}

timeSlider.addEventListener('input', updateTimeDisplay);

////////////////////////////////////////////////////////////////////////////////
// 6) Mapbox: Add Bike Lane Layers
////////////////////////////////////////////////////////////////////////////////
map.on('style.load', () => {
  // Boston
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Cambridge
  map.addSource('cambridge_bike_lanes', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/api/geospatial/gb5w-yva3?method=export&format=GeoJSON'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_bike_lanes',
    paint: {
      'line-color': 'blue',
      'line-width': 3,
      'line-opacity': 0.6
    }
  });

  console.log('✅ Boston + Cambridge bike lanes loaded.');
});

////////////////////////////////////////////////////////////////////////////////
// 7) Map on 'load': Fetch Stations + Trips, Draw Circles
////////////////////////////////////////////////////////////////////////////////
map.on('load', () => {
  const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  // 1) Load station JSON
  d3.json(stationUrl)
    .then(jsonData => {
      // 2) Then load trip CSV
      return d3.csv(trafficUrl).then(loadedTrips => {
        trips = loadedTrips.map(trip => ({
          ...trip,
          started_at: new Date(trip.started_at),
          ended_at: new Date(trip.ended_at)
        }));
        console.log('✅ Trips loaded:', trips.slice(0, 5));

        // 3) Compute initial station traffic
        stations = computeStationTraffic(jsonData.data.stations, trips);
        console.log('✅ Stations with traffic:', stations);

        // 4) Setup circle size scale
        const radiusScale = d3.scaleSqrt()
          .domain([0, d3.max(stations, d => d.totalTraffic)])
          .range([2, 25]);

        // 5) Create circles for each station
        const circles = svg.selectAll('circle')
          .data(stations, d => d.short_name)
          .enter()
          .append('circle')
          .attr('r', d => radiusScale(d.totalTraffic))
          .attr('fill', d => {
            if (!d.totalTraffic) return 'gray'; // no traffic
            const ratio = d.departures / d.totalTraffic;
            return colorScale(ratio);
          })
          .attr('opacity', 0.8)
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .each(function(d) {
            // Browser tooltip
            d3.select(this)
              .append('title')
              .text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
          });

        // 6) Position circles according to map view
        function updatePositions() {
          circles
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy);
        }
        updatePositions();
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // 7) Function to update circle sizes/colors when user changes time
        function updateScatterPlot(newTime) {
          // filter trips
          const filtered = filterTripsByTime(trips, newTime);
          // re-compute station traffic
          const updated = computeStationTraffic(stations, filtered);

          // if user picks a narrower time, enlarge the circles
          if (newTime === -1) {
            radiusScale.range([2, 25]);
          } else {
            radiusScale.range([3, 50]);
          }

          // re-bind data
          const updatedCircles = svg.selectAll('circle')
            .data(updated, d => d.short_name);

          updatedCircles
            .join('circle')
            .transition()
            .duration(500)
            .attr('r', d => radiusScale(d.totalTraffic))
            .attr('fill', d => {
              if (!d.totalTraffic) return 'gray';
              const ratio = d.departures / d.totalTraffic;
              return colorScale(ratio);
            });

          // also update tooltips
          updatedCircles.each(function(d) {
            let title = d3.select(this).select('title');
            if (title.empty()) {
              title = d3.select(this).append('title');
            }
            title.text(`${d.totalTraffic} trips (${d.departures} dep, ${d.arrivals} arr)`);
          });
        }

        // 8) Keep a reference so the slider can call it
        updateScatterPlotFn = updateScatterPlot;
        // 9) Run once with default timeFilter
        updateScatterPlot(timeFilter);
      });
    })
    .catch(err => console.error('❌ Error loading data:', err));
});
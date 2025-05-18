function calculateYieldGrowth(start, end) {
    const totalStart = start.reduce((a, b) => a + b, 0);
    const totalEnd = end.reduce((a, b) => a + b, 0);
    return (((totalEnd - totalStart) / totalStart) * 100).toFixed(1);
  }

  const centerTextPlugin = {
      id: 'centerText',
      beforeDraw(chart, args, options) {
          const { width } = chart;
          const { height } = chart;
          const ctx = chart.ctx;
          ctx.restore();

          const fontSize = options.fontSize || 16;
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = options.color || '#000';

          ctx.fillText(options.text, width / 2, height / 2);
          ctx.save();
      }
  };
  Chart.register(centerTextPlugin);

  // Store schedule data globally so we can reuse it
  let globalScheduleData;

  let irrigationDonut;
  let fertilizerDonut;

  function renderOverallStats(data) {
    const irrigation = data.irrigations;
    const fertilizer = data.fertilizers;
    const harvests = data.harvests;

    // Donut: Total Inches
    const irrigationLabels = Object.keys(irrigation);
    const irrigationValues = irrigationLabels.map(plant => {
        const total = irrigation[plant].reduce((sum, e) => sum + parseFloat(e.inches || 0), 0);
        return total.toFixed(2);
    });
    const irrigationTotal = irrigationValues.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);

    if (!irrigationDonut) {
    irrigationDonut = new Chart(document.getElementById('irrigationDonut'), {
      type: 'doughnut',
      data: {
          labels: irrigationLabels,
          datasets: [{
          data: irrigationValues,
          backgroundColor: ['#81c784', '#aed581', '#4caf50']
          }]
      },
      options: {
          plugins: {
          title: {
              display: true,
              text: 'Total Irrigation'
          },
          legend: { display: false },
          centerText: {
              text: `${irrigationTotal.toFixed(1)} in`,
              fontSize: 18,
              color: '#4caf50'
          }
          }
      },
      plugins: [centerTextPlugin]
      });
    } else {
      irrigationDonut.data.labels = irrigationLabels;
      irrigationDonut.data.datasets[0].data = irrigationValues;
      irrigationDonut.options.plugins.centerText.text = `${irrigationTotal.toFixed(1)} in`;
      irrigationDonut.update();
    }

    // Donut: Total Lbs Fertilizer
    const fertilizerLabels = Object.keys(fertilizer);
    const fertilizerValues = fertilizerLabels.map(plant => {
      const total = fertilizer[plant].reduce((sum, e) => sum + parseFloat(e.fert || 0), 0);
      return total.toFixed(2);
    });
    const fertilizerTotal = fertilizerValues.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);

    if (!fertilizerDonut) {
    fertilizerDonut = new Chart(document.getElementById('fertilizerDonut'), {
      type: 'doughnut',
      data: {
          labels: fertilizerLabels,
          datasets: [{
          data: fertilizerValues,
          backgroundColor: ['#ffb74d', '#ff8a65', '#ff7043']
          }]
      },
      options: {
          plugins: {
          title: {
              display: true,
              text: 'Total Fertilizer'
          },
          legend: { display: false },
          centerText: {
              text: `${fertilizerTotal.toFixed(1)} lbs`,
              fontSize: 18,
              color: '#ff7043'
          }
          }
      },
      plugins: [centerTextPlugin]
      });
    } else {
      fertilizerDonut.data.labels = fertilizerLabels;
      fertilizerDonut.data.datasets[0].data = fertilizerValues;
      fertilizerDonut.options.plugins.centerText.text = `${fertilizerTotal.toFixed(1)} lbs`;
      fertilizerDonut.update();
    }

    lineGraph(fertilizer, 'fert', 'Fertilizer over Time', 'Fertilizer (lbs)', 'fertilizerLine')
    lineGraph(irrigation, 'inches', 'Irrigation over Time', 'Water (in)', 'irrigationLine')
    //lineGraph(harvests, 'yield', 'Harvest Yield Over Time', 'Yield (lbs)', 'harvestLine')

    // Line: Harvest Yield
    const harvestLabels = Object.keys(harvests);

    const latest = harvestLabels.map(p => parseFloat(harvests[p].slice(-1)[0].yield || 0));
    const previous = harvestLabels.map(p => parseFloat(harvests[p].slice(-2)[0]?.yield || 0));
    const growth = calculateYieldGrowth(previous, latest);
    
    // Update yield growth progress circle
    const yieldGrowthElement = document.getElementById('yield-growth');
    const yieldProgressElement = document.getElementById('yield-progress');
    const circle = yieldProgressElement.querySelector('circle');
    
    // Calculate the percentage (cap at 100% for progress bar)
    const percentage = Math.min(Math.abs(growth), 100);
    
    // Update the circle progress
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    // Update color based on positive/negative growth
    circle.style.stroke = growth >= 0 ? '#4caf50' : '#f44336';
    
    // Update the text
    const growthText = growth >= 0 ? `+${growth}%` : `${growth}%`;
    yieldGrowthElement.textContent = growthText;
    yieldGrowthElement.style.color = growth >= 0 ? '#4caf50' : '#f44336';
  }


  document.addEventListener('DOMContentLoaded', function () {
    // Initialize the comparison charts first
    initializeComparisonCharts();

    fetch('/api/get_irrigations')
        .then(res => res.json())
        .then(data => {
          globalScheduleData = data;
          renderOverallStats(data);
        });
  });

  let plantData;
  // Add event listener for plant selector
  const plantSelector = document.getElementById('plant-selector');
  plantSelector.addEventListener('change', function() {
      const selectedPlant = this.value;
      if (selectedPlant) {
          // Use the existing schedule data
          fetch('/api/get_plant_specific_stats', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  plant: selectedPlant
              })
          })
          .then(response => response.json())
          .then(plantDatas => {
              plantData = plantDatas;
              updatePlantCharts(globalScheduleData);
          })
          .catch(error => console.error('Error fetching plant data:', error));
      }
  });

  let lineGraphs = {
    irrigationLine: null,
    fertilizerLine: null,
  };

  function lineGraph(data, varName, title, yAxisLabel, chartName) {
      const datasets = [];
      const plantColors = [
        '#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#f44336',
        '#00bcd4', '#8bc34a', '#ffc107', '#e91e63', '#3f51b5'
      ];
  
      const allDates = new Set();
  
      // Collect all unique dates
      Object.values(data).forEach(plant => {
          Object.values(plant).forEach(event => {
              allDates.add(event.date);
              console.log(event)
          });
      });
  
      // Sort dates
      const sortedDates = Array.from(allDates).sort();
  
      let colorIndex = 0;
  
      for (const [plant, events] of Object.entries(data)) {
        const dateMap = {};
        events.forEach(event => {
          dateMap[event.date] = parseFloat(event[varName]) || 0;
        });
  
        const irrigationSeries = sortedDates.map(date => dateMap[date] || 0);
  
        datasets.push({
          label: plant,
          data: irrigationSeries,
          borderColor: plantColors[colorIndex % plantColors.length],
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3
        });
  
        colorIndex++;
      }
  
      if (!lineGraphs[chartName]) {
        const ctx = document.getElementById(chartName).getContext('2d');
        lineGraphs[chartName] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: sortedDates,
          datasets: datasets
        },
        options: {
          responsive: true,
          plugins: {
              legend: {
                  display: false // move key to the top
              },
              tooltip: {
              mode: 'index',
              intersect: false
              },
              title: {
              display: true,
              text: title,
              // padding: {
              //     bottom: 10 // adds space between title and legend
              // }
              }
          },
          interaction: {
              mode: 'nearest',
              axis: 'x',
              intersect: false
          },
          scales: {
              y: {
              beginAtZero: true,
              title: {
                  display: true,
                  text: yAxisLabel
              }
              },
              x: {
              title: {
                  display: true,
                  text: 'Date'
              }
              }
          }
          }
      });
    } else {
      lineGraphs[chartName].data.labels = sortedDates;
      lineGraphs[chartName].data.datasets = datasets;
      lineGraphs[chartName].update();
    }
  }

  // Initialize charts as global variables
  let irrigationComparisonChart;
  let fertilizerComparisonChart;
  let npkComparisonChart;
  let harvestGrowthChart;

  // Function to parse NPK string into array of numbers
  function parseNPK(npkString) {
      return npkString.split('-').map(num => parseInt(num));
  }

  // Function to initialize the comparison charts
  function initializeComparisonCharts() {
      // Irrigation Comparison Chart
      if (!irrigationComparisonChart) {
        const irrigationCtx = document.getElementById('irrigationComparison').getContext('2d');
        irrigationComparisonChart = new Chart(irrigationCtx, {
            type: 'bar',
            data: {
                labels: ['Irrigation (inches)'],
                datasets: [
                    {
                        label: 'Ideal Amount',
                        data: [0],
                        backgroundColor: 'rgba(54, 162, 235, 0.5)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Average Amount',
                        data: [0],
                        backgroundColor: 'rgba(255, 99, 132, 0.5)',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Inches'
                        }
                    }
                },
                plugins: {
                  legend: {
                    display: false
                  }
                }
            }
        });
      } else {
        irrigationComparisonChart.data.datasets[0].data = [plantData.idealIrrigation];
        irrigationComparisonChart.data.datasets[1].data = [averageIrrigationInches];
        irrigationComparisonChart.update();
      }

      // Combined Fertilizer and NPK Chart
      if (!fertilizerComparisonChart) {
      const fertilizerCtx = document.getElementById('fertilizerComparison').getContext('2d');
      fertilizerComparisonChart = new Chart(fertilizerCtx, {
          type: 'bar',
          data: {
              labels: ['Ideal', 'Actual'],
              datasets: [
                  {
                      label: 'Nitrogen (N)',
                      data: [0, 0],
                      backgroundColor: '#2196f3',  // Blue for Nitrogen
                      stack: 'Stack 0'
                  },
                  {
                      label: 'Phosphorus (P)',
                      data: [0, 0],
                      backgroundColor: '#4caf50',  // Green for Phosphorus
                      stack: 'Stack 0'
                  },
                  {
                      label: 'Potassium (K)',
                      data: [0, 0],
                      backgroundColor: '#ff9800',  // Orange for Potassium
                      stack: 'Stack 0'
                  }
              ]
          },
          options: {
              responsive: true,
              scales: {
                  x: {
                      stacked: true
                  },
                  y: {
                      stacked: true,
                      beginAtZero: true,
                      title: {
                          display: true,
                          text: 'Pounds'
                      }
                  }
              },
              plugins: {
                  legend: {
                      display: true,
                      position: 'left'
                  },
                  title: {
                      display: false,
                  }
              }
          }
      });
      } else {
        fertilizerComparisonChart.data.datasets[0].data = [plantData.idealFertilizer];
        fertilizerComparisonChart.data.datasets[1].data = [averageFertilizerLbs];
        fertilizerComparisonChart.update();
      }

      // Harvest Growth Chart
      if (!harvestGrowthChart) {
      const harvestCtx = document.getElementById('harvestGrowth').getContext('2d');
      harvestGrowthChart = new Chart(harvestCtx, {
          type: 'line',
          data: {
              labels: [],
              datasets: [{
                  label: 'Harvest Yield',
                  data: [],
                  borderColor: '#4caf50',
                  backgroundColor: 'rgba(76, 175, 80, 0.1)',
                  fill: true,
                  tension: 0.4
              }]
          },
          options: {
              responsive: true,
              scales: {
                  y: {
                      beginAtZero: true,
                      title: {
                          display: true,
                          text: 'Yield (lbs)'
                      }
                  },
                  x: {
                      title: {
                          display: true,
                          text: 'Date'
                      }
                  }
              },
              plugins: {
                  legend: {
                      display: false
                  }
              }
          }
      });
      } else {
        harvestGrowthChart.data.labels = plantData.harvests.map(h => h.date);
        harvestGrowthChart.data.datasets[0].data = plantData.harvests.map(h => parseFloat(h.yield));
        harvestGrowthChart.update();
      }
  }

  // Add these functions at the top level
  function calculateEfficiency(actual, ideal) {
      return Math.max(0, 100 - (Math.abs(actual - ideal) / ideal) * 100);
  }

  function calculateNPKEfficiency(actualNPK, idealNPK) {
      const actual = parseNPK(actualNPK);
      const ideal = parseNPK(idealNPK);
      
      // Calculate efficiency for each component
      const nEfficiency = calculateEfficiency(actual[0], ideal[0]);
      const pEfficiency = calculateEfficiency(actual[1], ideal[1]);
      const kEfficiency = calculateEfficiency(actual[2], ideal[2]);
      
      // Return average of N, P, K efficiencies
      return (nEfficiency + pEfficiency + kEfficiency) / 3;
  }

  function calculateGrowthRate(harvests) {
      if (!harvests || harvests.length < 2) return 0;
      
      // Sort harvests by date
      const sortedHarvests = [...harvests].sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Get first and last harvest yields
      const firstYield = parseFloat(sortedHarvests[0].yield);
      const lastYield = parseFloat(sortedHarvests[sortedHarvests.length - 1].yield);
      
      // Calculate percentage growth
      const growthRate = ((lastYield - firstYield) / firstYield) * 100;
      return growthRate;
  }

  let averageIrrigationInches;
  let averageFertilizerLbs;
  let averageNPK;

  // Function to update charts with plant-specific data
  function updatePlantCharts(scheduleData) {
      const plant = plantData.name;
      
      // Calculate average irrigation from schedule
      averageIrrigationInches = 0;
      if (scheduleData.irrigations[plant]) {
          const totalIrrigation = scheduleData.irrigations[plant].reduce((sum, e) => sum + parseFloat(e.inches || 0), 0);
          averageIrrigationInches = totalIrrigation;
      }

      // Calculate average fertilizer and NPK from schedule
      averageFertilizerLbs = 0;
      averageNPK = '0-0-0';
      if (scheduleData.fertilizers[plant]) {
          const totalFertilizer = scheduleData.fertilizers[plant].reduce((sum, e) => sum + parseFloat(e.fert || 0), 0);
          averageFertilizerLbs = totalFertilizer;

          const npkEvents = scheduleData.fertilizers[plant].filter(e => e.npk);
          if (npkEvents.length > 0) {
              const npkValues = npkEvents.map(e => parseNPK(e.npk));
              const sumN = npkValues.reduce((sum, npk) => sum + npk[0], 0);
              const sumP = npkValues.reduce((sum, npk) => sum + npk[1], 0);
              const sumK = npkValues.reduce((sum, npk) => sum + npk[2], 0);
              const avgN = Math.round(sumN / npkValues.length);
              const avgP = Math.round(sumP / npkValues.length);
              const avgK = Math.round(sumK / npkValues.length);
              averageNPK = `${avgN}-${avgP}-${avgK}`;
          }
      }

      // Calculate efficiencies
      const irrigationEfficiency = calculateEfficiency(averageIrrigationInches, plantData.idealIrrigation);
      const fertilizerAmountEfficiency = calculateEfficiency(averageFertilizerLbs, plantData.idealFertilizer);
      const npkEfficiency = calculateNPKEfficiency(averageNPK, plantData.idealNPK);
      const fertilizerEfficiency = (fertilizerAmountEfficiency * 0.5) + (npkEfficiency * 0.5);

      // Update efficiency displays
      updateProgressCircle('irrigation-efficiency', 'irrigation-progress', irrigationEfficiency);
      updateProgressCircle('fertilizer-efficiency', 'fertilizer-progress', fertilizerEfficiency);

      // Update Irrigation Comparison
      irrigationComparisonChart.data.datasets[0].data = [plantData.idealIrrigation];
      irrigationComparisonChart.data.datasets[1].data = [averageIrrigationInches];
      irrigationComparisonChart.update();

      // Update Combined Fertilizer and NPK Comparison
      const idealNPK = parseNPK(plantData.idealNPK);
      const actualNPK = parseNPK(averageNPK);
      
      // Calculate the portion of fertilizer for each nutrient
      const idealTotal = idealNPK.reduce((a, b) => a + b, 0);
      const actualTotal = actualNPK.reduce((a, b) => a + b, 0);
      
      // Calculate pounds of each nutrient based on ratios
      const idealN = (idealNPK[0] / idealTotal) * plantData.idealFertilizer;
      const idealP = (idealNPK[1] / idealTotal) * plantData.idealFertilizer;
      const idealK = (idealNPK[2] / idealTotal) * plantData.idealFertilizer;
      
      const actualN = (actualNPK[0] / actualTotal) * averageFertilizerLbs;
      const actualP = (actualNPK[1] / actualTotal) * averageFertilizerLbs;
      const actualK = (actualNPK[2] / actualTotal) * averageFertilizerLbs;
      
      fertilizerComparisonChart.data.datasets[0].data = [idealN, actualN];    // N
      fertilizerComparisonChart.data.datasets[1].data = [idealP, actualP];    // P
      fertilizerComparisonChart.data.datasets[2].data = [idealK, actualK];    // K
      
      fertilizerComparisonChart.update();

      // Update Harvest Growth Chart
      let harvestData = [];
      let growthRate = 0;
      
      if (scheduleData.harvests && scheduleData.harvests[plant]) {
          const harvests = scheduleData.harvests[plant];
          // Sort harvests by date
          harvestData = [...harvests].sort((a, b) => new Date(a.date) - new Date(b.date));
          
          // Calculate growth rate
          growthRate = calculateGrowthRate(harvests);
          
          // Update chart
          harvestGrowthChart.data.labels = harvestData.map(h => h.date);
          harvestGrowthChart.data.datasets[0].data = harvestData.map(h => parseFloat(h.yield));
          harvestGrowthChart.update();
          
          // Update growth rate display with progress circle
          updateProgressCircle('growth-rate', 'growth-progress', growthRate, true);
      } else {
          // Clear chart if no harvest data
          harvestGrowthChart.data.labels = [];
          harvestGrowthChart.data.datasets[0].data = [];
          harvestGrowthChart.update();
          
          // Clear growth rate display
          document.getElementById('growth-rate').textContent = 'No Data';
          document.getElementById('growth-rate').style.color = '#666';
          // Reset progress circle
          const circle = document.querySelector('#growth-progress circle');
          if (circle) {
              circle.style.strokeDasharray = '0';
              circle.style.strokeDashoffset = '0';
              circle.style.stroke = '#666';
          }
      }
  }

  // Add this helper function after the existing functions
  function updateProgressCircle(elementId, progressId, value, isGrowth = false) {
    const element = document.getElementById(elementId);
    const progressElement = document.getElementById(progressId);
    const circle = progressElement.querySelector('circle');
    
    // Calculate the percentage (cap at 100% for progress bar)
    const percentage = Math.min(Math.abs(value), 100);
    
    // Update the circle progress
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    // Set color based on value
    let color;
    if (isGrowth) {
        // For growth metrics, use green for positive, red for negative
        color = value >= 0 ? '#4caf50' : '#f44336';
    } else {
        // For efficiency metrics, use color gradient based on percentage
        if (percentage >= 80) color = '#4caf50';      // Green for excellent
        else if (percentage >= 60) color = '#8bc34a';  // Light green for good
        else if (percentage >= 40) color = '#ffc107';  // Yellow for average
        else if (percentage >= 20) color = '#ff9800';  // Orange for poor
        else color = '#f44336';                        // Red for very poor
    }
    
    circle.style.stroke = color;
    
    // Update the text
    const displayText = isGrowth ? (value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`) : `${value.toFixed(1)}%`;
    element.textContent = displayText;
    element.style.color = color;
}

function filterDataByTimeRange(data, timeRange) {
  const now = new Date();
  let cutoffDate;
  
  switch(timeRange) {
      case 'week':
          cutoffDate = new Date(now.setDate(now.getDate() - 7));
          break;
      case 'month':
          cutoffDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
      case '3months':
          cutoffDate = new Date(now.setMonth(now.getMonth() - 3));
          break;
      case 'year':
          cutoffDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
      default:
          cutoffDate = new Date(now.setMonth(now.getMonth() - 1)); // Default to last month
  }

  // Create a deep copy of the data structure
  const filteredData = {
      irrigations: {},
      fertilizers: {},
      harvests: {}
  };

  // Filter irrigations
  Object.keys(data.irrigations || {}).forEach(plant => {
      const filtered = data.irrigations[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.irrigations[plant] = filtered;
      }
  });

  // Filter fertilizers
  Object.keys(data.fertilizers || {}).forEach(plant => {
      const filtered = data.fertilizers[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.fertilizers[plant] = filtered;
      }
  });

  // Filter harvests
  Object.keys(data.harvests || {}).forEach(plant => {
      const filtered = data.harvests[plant].filter(event => 
          new Date(event.date) >= cutoffDate
      );
      if (filtered.length > 0) {
          filteredData.harvests[plant] = filtered;
      }
  });

  return filteredData;
}

document.getElementById('time-range').addEventListener('change', function() {
    const selectedRange = this.value;
    const filteredData = filterDataByTimeRange(globalScheduleData, selectedRange);
    renderOverallStats(filteredData);
    updatePlantCharts(filteredData);
});
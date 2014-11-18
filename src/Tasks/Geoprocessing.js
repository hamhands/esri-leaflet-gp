/*
to do:
add event emitters?
*/

EsriLeafletGP.Tasks.Geoprocessing = Esri.Tasks.Task.extend({
  //setters: {}, we don't use these because we don't know the ParamName OR value of custom GP services
  params: {},
  resultParams: {},

  initialize: function(url, options) {
    //don't replace parent initialize
    L.esri.Tasks.Task.prototype.initialize.call(this, url, options);

    //if path isn't supplied in options, try and determine if its sync or async to set automatically
    if (!this.options.path) {
      //the parameters below seem wonky to me, but work for both CORS and JSONP requests
      this._service.request("", {'f':'json'}, function(error, results) {
        if (!error) {
          if (results.executionType === "esriExecutionTypeSynchronous") {
            this.options.async = false;
            this.options.path = "execute";
          } else {
            this.options.async = true;
            this.options.path = "submitJob";
          }
        } else {
          //if check fails, hopefully its generic synchronous
          this.options.async = false;
          this.options.path = "execute";
          return;
        }
      }, this);
    }
    else {
      //if path is custom, hopefully its synchronous
      if (this.options.async != true && this.options.path != "submitJob") {
        this.options.async = false;
      }
    }
  },
  //doc for various GPInput types can be found here
  //http://resources.arcgis.com/en/help/arcgis-rest-api/index.html#/GP_Result/02r3000000q7000000/

  gpString: function(paramName, paramValue) {
    if (typeof paramValue === "string") {
      this.params[paramName] = paramValue;
    }
  },

  gpNumber: function(paramName, paramValue) {
    if (typeof paramValue === "number") {
      this.params[paramName] = paramValue;
    }
  },

  gpBoolean: function(paramName, bool) {
    if (typeof bool === "boolean") {
      this.params[paramName] = bool;
    }
  },

  //necessary because of the design requirement that resultParams be specified for async elevation services in order to get Zs (unnecessarily confusing)
  gpAsyncResultParam: function(paramName, paramValue) {
    this.resultParams[paramName] = paramValue;
  },

  //should try and implement query._setGeometry() instead (to accept LatLng, Bounds etc.)
  gpGeoJson: function(paramName, geoJson) {
    var processedInput = {
      "geometryType": "",
      "features": []
    };

    //confirmed we handle raw GeoJSON geometries appropriately too, but what about 'feature' type objects outside of FeatureCollections or 'GeometryCollections'?
    if (geoJson.type === "FeatureCollection") {
      processedInput.geometryType = this.geoJsonTypeToArcGIS(geoJson.features[0].geometry.type);
      processedInput.features = L.esri.Util.geojsonToArcGIS(geoJson);
    } else if (geoJson.type === "Feature") {
      processedInput.geometryType = this.geoJsonTypeToArcGIS(geoJson.geometry.type);
      processedInput.features.push(L.esri.Util.geojsonToArcGIS(geoJson));
    } else {
      processedInput.geometryType = this.geoJsonTypeToArcGIS(geoJson.type);
      processedInput.features.push({
        "geometry": L.esri.Util.geojsonToArcGIS(geoJson)
      });
    }
    this.params[paramName] = processedInput;
  },

  geoJsonTypeToArcGIS: function(geoJsonType) {
    var arcgisGeometryType;
    switch (geoJsonType) {
      case "Point":
        arcgisGeometryType = "esriGeometryPoint";
        break;
      case "LineString":
        arcgisGeometryType = "esriGeometryPolyline";
        break;
      case "Polygon":
        arcgisGeometryType = "esriGeometryPolygon";
        break;
      default:
        console.error("unable to map geoJson geometry type to an arcgis geometry type");
    }
    return arcgisGeometryType;
  },

  run: function(callback, context) {
    var jobId;
    if (this.options.async === true) {
      this._service.request(this.options.path, this.params, function(error, response) {
        jobId = response.jobId;
        this.checkJob(jobId, callback, context);
      }, this);
    } else {
      return this._service.request(this.options.path, this.params, function(error, response) {
        callback.call(context, error, (response && this.processGPOutput(response)), response);
      }, this);
    }
  },

  checkJob: function(jobId, callback, context) {
    var pollJob = function() {
      this.request("/jobs/" + jobId, {}, function polledJob(error, response) {
        if (response.jobStatus === "esriJobSucceeded") {
          this.request("/jobs/" + jobId + "/results/OutputProfile", this.resultParams, function processJobResult(error, response) {
            callback.call(context, error, (response && this.processGPOutput(response)), response);

          }, this);
          window.clearInterval(counter);
        } else if (response.jobStatus === "esriJobFailed") {
          callback.call(context, "Job Failed", null);
          window.clearInterval(counter);
        }
      }, this);
    }.bind(this);

    var counter = window.setInterval(pollJob, 1000);

  },

  processGPOutput: function(response) {
    var processedResponse = {};
    var responseValue;

    if (this.options.async === false) {
      responseValue = response.results[0].value;
    } else {
      responseValue = response.value;
    }

    if (responseValue.features) {
      var featureCollection = L.esri.Util.responseToFeatureCollection(responseValue);
      processedResponse.features = featureCollection.features;
    } else if (response.results[0].dataType === "GPDataFile") {
      processedResponse.result = response.results[0];
    }
    //do we need to be able to pass back output booleans? strings? numbers?
    return processedResponse;
  }

});

EsriLeafletGP.Tasks.geoprocessing = function(url, params) {
  return new EsriLeafletGP.Tasks.Geoprocessing(url, params);
};
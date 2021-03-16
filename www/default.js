'use strict';

var g_app_initialized = false;
var g_data_table = null;
var g_settings = {};

var g_settings_defaults = {
  pricing_unit: 'instance',
  cost_duration: 'hourly',
  region: 'us-east-1',
  reserved_term: 'yrTerm1Standard.noUpfront',
  min_memory: 0,
  min_vcpus: 0,
  min_memory_per_vcpu: 0,
  min_storage: 0,
  selected: '',
  compare_on: false,
  measuring_units_on: true,
  price_modifier: 1
};

function init_data_table() {
  // create a second header row
  $("#data thead tr").clone(true).appendTo("#data thead");
  // add a text input filter to each column of the new row
  $("#data thead tr:eq(1) th").each(function (i) {
    var title = $(this).text();
    $(this).html("<input type='text' placeholder='Search '" + title + "' />");
    $("input", this).on( "keyup change", function () {
      if (g_data_table.column(i).search() !== this.value) {
        g_data_table.column(i).search(this.value).draw();
      }
    });
  });
  g_data_table = $('#data').DataTable({
    "bPaginate": false,
    "bInfo": false,
    "bStateSave": true,
    "orderCellsTop": true,
    "oSearch": {
      "bRegex": true,
      "bSmart": false
    },
    "aoColumnDefs": [
      {
        // The columns below are sorted according to the sort attr of the <span> tag within their data cells
        "aTargets": [
          "memory",
          "computeunits",
          "vcpus",
          "storage",
          "ebs-throughput",
          "ebs-iops",
          "ebs-max-bandwidth",
          "networkperf",
          "cost-ondemand",
          "cost-reserved",
          "cost-ebs-optimized",
        ],
        "sType": "span-sort"
      },
      {
        // The columns below are hidden by default
        "aTargets": [
          "architecture",
          "computeunits",
          "memory-per-vcpu",
          "ecu-per-vcpu",
          "emr-support",
          "gpus",
          "gpu_model",
          "gpu_memory",
          "compute_capability",
          "fpgas",
          "physical_processor",
          "clock_speed_ghz",
          "intel_avx",
          "intel_avx2",
          "intel_avx512",
          "intel_turbo",
          "enhanced-networking",
          "maxips",
          "maxenis",
          "linux-virtualization",
          "cost-emr",
          "cost-ondemand-rhel",
          "cost-ondemand-sles",
          "cost-ondemand-mswinSQL",
          "cost-ondemand-mswinSQLEnterprise",
          "cost-ondemand-mswinSQLWeb",
          "cost-ondemand-linuxSQL",
          "cost-ondemand-linuxSQLEnterprise",
          "cost-ondemand-linuxSQLWeb",
          "cost-reserved-rhel",
          "cost-reserved-sles",
          "cost-reserved-mswinSQL",
          "cost-reserved-mswinSQLEnterprise",
          "cost-reserved-mswinSQLWeb",
          "cost-reserved-linuxSQL",
          "cost-reserved-linuxSQLEnterprise",
          "cost-reserved-linuxSQLWeb",
          "ebs-throughput",
          "ebs-iops",
          "ebs-as-nvme",
          "ebs-max-bandwidth",
          "cost-ebs-optimized",
          "trim-support",
          "warmed-up",
          "ipv6-support",
          "placement-group-support",
          "vpc-only",
          "azs"
        ],
        "bVisible": false
      }
    ],
    // default sort by linux cost
    "aaSorting": [
      [15, "asc"]
    ],
    'initComplete': function () {
      // fire event in separate context so that calls to get_data_table()
      // receive the cached object.
      setTimeout(function () {
        on_data_table_initialized();
      }, 0);
    },
    'drawCallback': function () {
      // abort if initialization hasn't finished yet (initial draw)
      if (g_data_table === null) {
        return;
      }

      // Whenever the table is drawn, update the costs. This is necessary
      // because the cost duration may have changed while a filter was being
      // used and so some rows will need updating.
      redraw_costs();
    },
    // Store filtering, sorting, etc - core datatable feature
    'stateSave': true,
    // Allow export to CSV
    'buttons': ['csv']
  });

  g_data_table
    .buttons()
    .container()
    .find('a')
    .addClass('btn btn-primary')
    .appendTo($('#menu > div'));

  return g_data_table;
}

$(document).ready(function () {
  init_data_table();
});


function change_cost(duration, pricing_unit, price_modifier) {
  // update pricing duration menu text
  var first = duration.charAt(0).toUpperCase();
  var text = first + duration.substr(1);
  $("#cost-dropdown .dropdown-toggle .text").text(text);

  // update pricing duration selected menu option
  $('#cost-dropdown li a').each(function (i, e) {
    e = $(e);
    if (e.attr('duration') == duration) {
      e.parent().addClass('active');
    } else {
      e.parent().removeClass('active');
    }
  });

  // update pricing unit selected menu option
  $('#pricing-unit-dropdown li a').each(function (i, e) {
    e = $(e);
    if (e.attr('pricing-unit') == pricing_unit) {
      e.parent().addClass('active');
      // update pricing unit menu text
      $("#pricing-unit-dropdown .dropdown-toggle .text").text(e.text());
    } else {
      e.parent().removeClass('active');
    }
  });

  var hour_multipliers = {
    "secondly": 1 / (60 * 60),
    "hourly": 1,
    "daily": 24,
    "weekly": (7 * 24),
    "monthly": (365 * 24 / 12),
    "annually": (365 * 24)
  };

  var measuring_units = {
    'vcpu': 'vCPU',
    'ecu': 'units',
    'memory': 'GiB'
  };

  var duration_multiplier = hour_multipliers[duration];
  var pricing_unit_modifier = 1;
  var per_time;

  // not relying on the "hiddable" class to control suffix rendering as the change_cost() overwrites
  // the entire td elements html. the overlap would just muddy things.
  var pricing_measuring_units = ''
  if (g_settings.measuring_units_on) {
    var pricing_measuring_units = ' ' + duration
    if (pricing_unit != 'instance') {
      pricing_measuring_units = pricing_measuring_units + ' per ' + measuring_units[pricing_unit];
    }
  }
  $.each($("td.cost-ondemand"), function (i, elem) {
    elem = $(elem);
    if (pricing_unit != 'instance') {
      pricing_unit_modifier = elem.data(pricing_unit);
    }
    per_time = get_pricing(elem.closest("tr").attr("id"), g_settings.region, elem.data("platform"), "ondemand");
    if (per_time && !isNaN(per_time) && !isNaN(pricing_unit_modifier) && pricing_unit_modifier > 0) {
      per_time = (price_modifier * per_time * duration_multiplier / pricing_unit_modifier).toFixed(6);
      elem.html('<span sort="' + per_time + '">$' + per_time + pricing_measuring_units + '</span>');
    } else {
      elem.html('<span sort="999999">unavailable</span>');
    }
  });

  $.each($("td.cost-reserved"), function (i, elem) {
    elem = $(elem);
    if (pricing_unit != 'instance') {
      pricing_unit_modifier = elem.data(pricing_unit);
    }
    per_time = get_pricing(elem.closest("tr").attr("id"), g_settings.region, elem.data("platform"), "reserved", g_settings.reserved_term);
    if (per_time && !isNaN(per_time) && !isNaN(pricing_unit_modifier) && pricing_unit_modifier > 0) {
      per_time = (price_modifier * per_time * duration_multiplier / pricing_unit_modifier).toFixed(6);
      elem.html('<span sort="' + per_time + '">$' + per_time + pricing_measuring_units + '</span>');
    } else {
      elem.html('<span sort="999999">unavailable</span>');
    }
  });

  $.each($("td.cost-ebs-optimized"), function (i, elem) {
    elem = $(elem);
    if (pricing_unit != 'instance') {
      pricing_unit_modifier = elem.data(pricing_unit);
    }
    per_time = get_pricing(elem.closest("tr").attr("id"), g_settings.region, "ebs");
    if (per_time && !isNaN(per_time) && !isNaN(pricing_unit_modifier) && pricing_unit_modifier > 0) {
      per_time = (price_modifier * per_time * duration_multiplier / pricing_unit_modifier).toFixed(6);
      elem.html('<span sort="' + per_time + '">$' + per_time + pricing_measuring_units + '</span>');
    } else {
      elem.html('<span sort="999999">unavailable</span>');
    }
  });

  $.each($("td.cost-emr"), function (i, elem) {
    elem = $(elem);
    if (pricing_unit != 'instance') {
      pricing_unit_modifier = elem.data(pricing_unit);
    }
    per_time = get_pricing(elem.closest("tr").attr("id"), g_settings.region, "emr", "emr");
    if (per_time && !isNaN(per_time) && !isNaN(pricing_unit_modifier) && pricing_unit_modifier > 0) {
      per_time = (price_modifier * per_time * duration_multiplier / pricing_unit_modifier).toFixed(6);
      elem.html('<span sort="' + per_time + '">$' + per_time + pricing_measuring_units + '</span>');
    } else {
      elem.html('<span sort="999999">unavailable</span>');
    }
  });

  g_settings.cost_duration = duration;
  g_settings.pricing_unit = pricing_unit;
  maybe_update_url();
}

function change_availability_zones() {
  $.each($("td.azs"), function (i, elem) {
    elem = $(elem);
    var instance_type = elem.closest("tr").attr("id");
    var instance_azs = get_instance_availability_zones(instance_type, g_settings.region);
    if (Array.isArray(instance_azs) && instance_azs.length) {
      var instance_azs_string = instance_azs.join(", ");
      elem.html(instance_azs_string);
    } else {
      elem.empty();
    }
  });
}

function change_region(region) {
  g_settings.region = region;
  var region_name = null;
  $('#region-dropdown li a').each(function (i, e) {
    e = $(e);
    if (e.data('region') === region) {
      e.parent().addClass('active');
      region_name = e.text();
    } else {
      e.parent().removeClass('active');
    }
  });
  $("#region-dropdown .dropdown-toggle .text").text(region_name);
  change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
  change_availability_zones();

  // redraw table to pick up on new sort values
  g_data_table.rows().invalidate().draw();
}

function change_reserved_term(term) {
  g_settings.reserved_term = term;
  var $dropdown = $('#reserved-term-dropdown'),
    $activeLink = $dropdown.find('li a[data-reserved-term="' + term + '"]'),
    term_name = $activeLink.text();

  $dropdown.find('li').removeClass('active');
  $activeLink.closest('li').addClass('active');

  $dropdown.find('.dropdown-toggle .text').text(term_name);
  change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
}

// Update all visible costs to the current duration.
// Called after new columns or rows are shown as their costs may be inaccurate.
function redraw_costs() {
  change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
  apply_measuring_units_visibility();
}

function setup_column_toggle() {
  $.each(g_data_table.columns().indexes(), function (i, idx) {
    var column = g_data_table.column(idx);
    $("#filter-dropdown ul").append(
      $('<li>')
        .toggleClass('active', column.visible())
        .append(
          $('<a>', {href: "javascript:;"})
            .text($(column.header()).text())
            .click(function (e) {
              toggle_column(i);
              $(this).parent().toggleClass("active");
              $(this).blur(); // prevent focus style from sticking in Firefox
              e.stopPropagation(); // keep dropdown menu open
            })
        )
    );
  });
}

function setup_clear() {
  $('.btn-clear').click(function () {
    // Reset app.
    g_settings = JSON.parse(JSON.stringify(g_settings_defaults)); // clone
    g_data_table.search("");
    clear_row_selections();
    maybe_update_url();
    store.clear();
    g_data_table.state.clear();
    window.location.reload();
  });
}

function clear_row_selections() {
  $('#data tbody tr').removeClass('highlight');
}

function url_for_selections() {
  var params = {
    min_memory: g_settings.min_memory,
    min_vcpus: g_settings.min_vcpus,
    min_memory_per_vcpu: g_settings.min_memory_per_vcpu,
    min_storage: g_settings.min_storage,
    filter: g_data_table.settings()[0].oPreviousSearch['sSearch'],
    region: g_settings.region,
    pricing_unit: g_settings.pricing_unit,
    cost_duration: g_settings.cost_duration,
    reserved_term: g_settings.reserved_term,
    compare_on: g_settings.compare_on,
    measuring_units_on: g_settings.measuring_units_on,
    price_modifier : g_settings.price_modifier
  };

  // avoid storing empty or default values in URL
  for (var key in params) {
    if (params[key] === '' || params[key] == null || params[key] === g_settings_defaults[key]) {
      delete params[key];
    }
  }

  // selected rows
  var selected_row_ids = $('#data tbody tr.highlight').map(function () {
    return this.id;
  }).get();
  if (selected_row_ids.length > 0) {
    params.selected = selected_row_ids;
  }

  var url = location.origin + location.pathname;
  var parameters = [];
  for (var setting in params) {
    if (params[setting] !== undefined) {
      parameters.push(setting + '=' + params[setting]);
    }
  }
  if (parameters.length > 0) {
    url = url + '?' + parameters.join('&');
  }
  return url;
}

function maybe_update_url() {
  // Save localstorage data as well
  store.set('ec2_settings', g_settings);

  if (!history.replaceState) {
    return;
  }

  try {
    var url = url_for_selections();
    if (document.location == url) {
      return;
    }

    history.replaceState(null, '', url);
  } catch (ex) {
    // doesn't matter
  }
}

var apply_price_modifier = function () {
  var all_filters = $('[data-action="datafilter"]');
  price_modifier = parseFloat($('[data-action="price_modifier"][data-type="price_modifier"]').val());
  g_settings.price_modifier = price_modifier;

  change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
  maybe_update_url();
};

var apply_min_values = function () {
  var all_filters = $('[data-action="datafilter"]');
  var data_rows = $('#data tr:has(td)');

  data_rows.show();

  all_filters.each(function () {
    var filter_on = $(this).data('type');
    var filter_val = parseFloat($(this).val()) || 0;

    // update global variable for dynamic URL
    g_settings["min_" + filter_on.replace('-', '_')] = filter_val;

    var match_fail = data_rows.filter(function () {
      var row_val;
      row_val = parseFloat(
        $(this).find('td[class~="' + filter_on + '"] span').attr('sort')
      );
      return row_val < filter_val;
    });

    match_fail.hide();
  });
  maybe_update_url();
};

function on_data_table_initialized() {
  if (g_app_initialized) return;
  g_app_initialized = true;

  load_settings();

  $('[data-action="price_modifier"][data-type="price_modifier"]').val(g_settings['price_modifier']);

  // populate filter inputs
  $('[data-action="datafilter"][data-type="memory"]').val(g_settings['min_memory']);
  $('[data-action="datafilter"][data-type="vcpus"]').val(g_settings['min_vcpus']);
  $('[data-action="datafilter"][data-type="memory-per-vcpu"]').val(g_settings['min_memory_per_vcpu']);
  $('[data-action="datafilter"][data-type="storage"]').val(g_settings['min_storage']);
  g_data_table.search(g_settings['filter']);
  apply_min_values();

  // apply highlight to selected rows
  $.each(g_settings.selected.split(','), function (_, id) {
    id = id.replace('.', '\\.');
    $('#' + id).addClass('highlight');
  });

  configure_measuring_units();
  configure_highlighting();

  // Allow row filtering by min-value match.
  $('[data-action=datafilter]').on('keyup', apply_min_values);

  $('[data-action=price_modifier]').on('keyup', apply_price_modifier);

  change_region(g_settings.region);
  change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
  change_reserved_term(g_settings.reserved_term);
  apply_measuring_units_visibility();

  $.extend($.fn.dataTableExt.oStdClasses, {
    "sWrapper": "dataTables_wrapper form-inline"
  });

  setup_column_toggle();

  setup_clear();

  // enable bootstrap tooltips
  $('abbr').tooltip({
    placement: function (tt, el) {
      return (this.$element.parents('thead').length) ? 'top' : 'right';
    }
  });

  $("#pricing-unit-dropdown li").bind("click", function (e) {
    change_cost(g_settings.cost_duration, e.target.getAttribute("pricing-unit"), g_settings.price_modifier);
  });

  $("#cost-dropdown li").bind("click", function (e) {
    change_cost(e.target.getAttribute("duration"), g_settings.pricing_unit, g_settings.price_modifier);
  });

  $("#region-dropdown li").bind("click", function (e) {
    change_region($(e.target).data('region'));
  });

  $("#reserved-term-dropdown li").bind("click", function (e) {
    change_reserved_term($(e.target).data('reservedTerm'));
  });

  // apply classes to search box
  $('div.dataTables_filter input').addClass('form-control search');
}

// sorting for colums with more complex data
// http://datatables.net/plug-ins/sorting#hidden_title
jQuery.extend(jQuery.fn.dataTableExt.oSort, {
  "span-sort-pre": function (elem) {
    var matches = elem.match(/sort="(.*?)"/);
    if (matches) {
      return parseFloat(matches[1]);
    }
    return 0;
  },

  "span-sort-asc": function (a, b) {
    return ((a < b) ? -1 : ((a > b) ? 1 : 0));
  },

  "span-sort-desc": function (a, b) {
    return ((a < b) ? 1 : ((a > b) ? -1 : 0));
  }
});

// toggle columns
function toggle_column(col_index) {
  var is_visible = g_data_table.column(col_index).visible();
  g_data_table.column(col_index).visible(is_visible ? false : true);
  redraw_costs();
}

// retrieve all the parameters from the location string
function load_settings() {
  // load settings from local storage
  g_settings = store.get('ec2_settings') || {};

  if (location.search) {
    var params = location.search.slice(1).split('&');
    params.forEach(function (param) {
      var parts = param.split('=');
      var key = parts[0];
      var val = parts[1];
      // support legacy key names
      if (key == 'cost') {
        key = 'cost_duration';
      } else if (key == 'term') {
        key = 'reserved_term';
      }
      // store in global settings
      console.log('Loaded setting from URL:', key, '=', val);
      g_settings[key] = val;
    });
  }

  // use default settings for missing values
  for (var key in g_settings_defaults) {
    if (g_settings[key] === undefined) {
      g_settings[key] = g_settings_defaults[key];
    }
  }

  return g_settings;
}

function configure_measuring_units() {
  var $measuringUnitsBtn = $('.btn-measuring-units');

  $measuringUnitsBtn.click(function () {
    g_settings.measuring_units_on = !g_settings.measuring_units_on;
    update_measuring_units_button();
    change_cost(g_settings.cost_duration, g_settings.pricing_unit, g_settings.price_modifier);
    apply_measuring_units_visibility();
    maybe_update_url();
  });

  update_measuring_units_button();
}

function apply_measuring_units_visibility() {
  $.each($(".hiddable"), function (i, elem) {
    elem = $(elem);
    if (g_settings.measuring_units_on) {
      elem.show()
    } else {
      elem.hide()
    }
  });
}

function update_measuring_units_button() {
  var $measuringUnitsBtn = $('.btn-measuring-units');

  if (! g_settings.measuring_units_on) {
    $measuringUnitsBtn.text($measuringUnitsBtn.data('textOff'))
        .addClass('btn-primary')
        .removeClass('btn-success');
  } else {
    $measuringUnitsBtn.text($measuringUnitsBtn.data('textOn'))
        .addClass('btn-success')
        .removeClass('btn-primary');
  }
}

function configure_highlighting() {
  var $compareBtn = $('.btn-compare'),
    $rows = $('#data tbody tr');

  // Allow row highlighting by clicking.
  $rows.click(function () {
    $(this).toggleClass('highlight');

    update_compare_button();
    maybe_update_url();
  });

  $compareBtn.click(function () {
    g_settings.compare_on = !g_settings.compare_on;
    update_compare_button();
    update_visible_rows();
    maybe_update_url();
  });

  update_compare_button();
  update_visible_rows();
}

function update_visible_rows() {
  var $rows = $('#data tbody tr');
  if (! g_settings.compare_on) {
    $rows.show();
  } else {
    $rows.filter(':not(.highlight)').hide();
  }
}

function update_compare_button() {
  var $compareBtn = $('.btn-compare'),
      $rows = $('#data tbody tr');

  if (! g_settings.compare_on) {
    $compareBtn.text($compareBtn.data('textOff'))
        .addClass('btn-primary')
        .removeClass('btn-success')
        .prop('disabled', !$rows.is('.highlight'));
  } else {
    $compareBtn.text($compareBtn.data('textOn'))
        .addClass('btn-success')
        .removeClass('btn-primary');
  }
}

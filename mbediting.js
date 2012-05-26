/*!
* MusicBrainz Editing
*
* Copyright (c) Aurélien Mino
* Available under the LGPL license
*/

var MB = MB || {};

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                          MusicBrainz Editing helper functions
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// ---------------------------------- internal ajax queuing/throttling ------------------------------------ //
// ----------------------------------     Code by bitmap    ------------------------------------ //

function RequestManager(rate) {
    this.queue = [];
    this.last = 0;

    this.next = function() {
        var request = this.queue.shift();
        if (request) {
            request();
            this.last = new Date().getTime();
            if (this.queue.length > 0) {
                setTimeout(function(foo) {foo.next();}, rate, this);
            }
        }
    }

    this.push = function(req) {
        this.queue.push(req);
        if (this.queue.length == 1)
            this.start_queue();
    }

    this.unshift = function(req) {
        this.queue.unshift(req);
        if (this.queue.length == 1)
            this.start_queue();
    }

    this.start_queue = function() {
        var now = new Date().getTime();
        if (now - this.last >= rate) {
            this.next();
        } else {
            setTimeout(function(foo) {foo.next();},
                rate - now + this.last, this);
        }
    }
}

/*
 * Authentification on MusicBrainz is not handled. An open session in the browser is assumed.
 * Warning: Not all of functions are thread-safe.
 *
 */

MB.Editing = (function() {

    var constants = {
        MUSICBRAINZ_HOST: "musicbrainz.org",
        AJAX_REQUEST_RATE: 1000
    };

    var utils = {
        MBID_REGEX: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/
    };

    var requestManager = new RequestManager(constants.AJAX_REQUEST_RATE);

    var entity_properties = {
        _common: [ 'name', 'comment' ],
        artist: [],
        work: [ 'iswc', 'type_id' ]
    }

    // ---------------------------------- internal editing functions ------------------------------------ //

    $.each(entity_properties, function(entity, properties) {
        if (entity == "_common") { return true; }
        jQuery.merge( entity_properties[entity], entity_properties['_common'] );
    });

    function fnCreateRelationship (type0, type1, entity0, entity1, linkTypeId, attributes, editnote, autoedit, successFallback, errorFallback) {

        var paramPrefix = 'ar';

        if (!attributes) attributes = {};

        var postAction = "/edit/relationship/create?type0=" + type0 + "&type1=" + type1
            + "&entity0="+entity0+"&entity1="+entity1;
        var postParameters = {};
        appendParameter (postParameters, paramPrefix, "link_type_id", linkTypeId);
        appendParameter (postParameters, paramPrefix, "edit_note", editnote, "");
        appendParameter (postParameters, paramPrefix, "as_auto_editor", autoedit ? 1 : 0);

        $.each(Object.keys(attributes), function(index, attr) {
            appendParameter (postParameters, paramPrefix, "attrs."+attr, attributes[attr]);
        });

        var edit = function() {
            $.ajax({
              type: 'POST',
              url: postAction,
              data: postParameters,
              success: successFallback,
              error: errorFallback
            });
        }
        requestManager.push(edit);
    }

    function fnCreateWork (info, editnote, autoedit, successFallback, errorFallback) {

        var paramPrefix = 'edit-work';

        var postAction = "/work/create";
        var postParameters = {};
        appendParameter (postParameters, paramPrefix, "name", info.name);
        appendParameter (postParameters, paramPrefix, "comment", info.comment);
        appendParameter (postParameters, paramPrefix, "type_id", info.type, "");
        appendParameter (postParameters, paramPrefix, "edit_note", editnote, "");
        appendParameter (postParameters, paramPrefix, "as_auto_editor", autoedit ? 1 : 0);

        var edit = function() {
            $.ajax({
              type: 'POST',
              url: postAction,
              data: postParameters,
              success: successFallback,
              error: errorFallback
            });
        }
        requestManager.push(edit);
    }

    function fnAddISWC (work_mbid, iswc, editnote, autoedit, successFallback, errorFallback) {

        var paramPrefix = 'add-iswc';

        var postAction = "/work/"+ work_mbid +"/add-iswc";
        var postParameters = {};
        appendParameter (postParameters, paramPrefix, "iswc", iswc);
        appendParameter (postParameters, paramPrefix, "edit_note", editnote, "");
        appendParameter (postParameters, paramPrefix, "as_auto_editor", autoedit ? 1 : 0);

        var edit = function() {
            $.ajax({
              type: 'POST',
              url: postAction,
              data: postParameters,
              success: successFallback,
              error: errorFallback
            });
        }
        requestManager.push(edit);
    }

    function fnLookupEntity(entity_type, entity_gid, incOptions, callBack) {
        var wsurl = "http://" + constants.MUSICBRAINZ_HOST + "/ws/2/" + entity_type + "/" + entity_gid;
        $.each(incOptions, function(i,option) {
            wsurl += (i == 0) ? "?inc=" : "+";
            wsurl += option;
        });

        var lookup = function() {
            $.get(wsurl,
                function(data) {
                    var $xmlentity = $(data).find('#'+entity_gid);
                    var entity = {
                        mbid: entity_gid,
                        name: $xmlentity.children("title, name").text(),
                        comment: $xmlentity.children("disambiguation").text()
                    };

                    if (entity_type == 'work') {
                        entity.type = $xmlentity.attr('type');
                        if (MB.Referential.WORK_TYPES_IDS.hasOwnProperty(entity.type)) {
                            entity['type_id'] = MB.Referential.WORK_TYPES_IDS[ entity.type ];
                        }
                        entity.iswc = [];
                        $xmlentity.children('iswc-list').each(function() {
                            entity.iswc.push($(this).text());
                        });
                    }

                    entity.relationships = {};
                    // Relationships
                    $xmlentity.children('relation-list').each(function() {
                        $relations = $(this);
                        target_type = $relations.attr('target-type');
                        if (!entity.relationships.hasOwnProperty(target_type)) {
                            entity.relationships[target_type] = {};
                        }
                        $relations.children('relation').each(function() {
                            $relation = $(this);
                            relation_type = $relation.attr('type');
                            if (!entity.relationships[target_type].hasOwnProperty(relation_type)) {
                                entity.relationships[target_type][relation_type] = [];
                            }
                            $target_entity = $relation.children(target_type);
                            target = { id: $target_entity.attr('id'), name: $target_entity.children('name').text() };
                            entity.relationships[target_type][relation_type].push(target);
                        });
                    });

                    callBack(entity);
                }
            ).error(function() {
                requestManager.unshift(function() {
                    fnLookupEntity(entity_type, entity_gid, incOptions, callBack);
                });
            });
        }
        requestManager.push(lookup);
    }

    function fnEditEntity (entity_type, entity_gid, update, editnote, autoedit, successFallback, errorFallback) {

        fnLookupEntity(entity_type, entity_gid, [], function(entity) {

            var paramPrefix = 'edit-' + entity_type;

            var postAction = "/" + entity_type + "/" + entity.mbid + "/edit";
            var postParameters = {};
            $.each(entity_properties[entity_type], function(index, property) {
                appendParameter (postParameters, paramPrefix, property, property in update ? update[property] : entity[property], "");
            });
            appendParameter (postParameters, paramPrefix, "edit_note", editnote, "");
            appendParameter (postParameters, paramPrefix, "as_auto_editor", autoedit ? 1 : 0, 0);

            var edit = function() {
                $.ajax({
                  type: 'POST',
                  url: postAction,
                  data: postParameters,
                  success: successFallback,
                  error: errorFallback
                }).error(function() {
                    requestManager.unshift(edit);
                });
            }
            requestManager.push(edit);
        });

    }

    function fnEditWork (mbid, update, editnote, autoedit, successFallback, errorFallback) {
        fnEditEntity('work', mbid, update, editnote, autoedit, successFallback, errorFallback);
    }

    function approveEdit(edit_id, callback) {
        var url = 'http://musicbrainz.org/edit/'+edit_id+'/approve'
        var approve = function() {
            $.get(url, function() {
                callback(edit_id);
            }).error(function() {
                requestManager.unshift(approve);
            });
        }
        requestManager.push(approve);

    }

    // ------------------------------------- utils funtions -------------------------------------- //

    function appendParameter(parameters, paramNamePrefix, paramName, paramValue, paramDefaultValue) {
        parameters[ paramNamePrefix + "." + paramName ] = (typeof paramValue === 'undefined') ? paramDefaultValue : paramValue ;
    }

    // ---------------------------------- expose publics here ------------------------------------ //

	return {
        requestManager: requestManager,
        utils: utils,
        constants: constants,
        createRelationship: fnCreateRelationship,
        createWork: fnCreateWork,
        editWork: fnEditWork,
        lookup: fnLookupEntity,
        addISWC: fnAddISWC,
        approveEdit: approveEdit
    };
})();

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                          MusicBrainz Editing tools
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

MB.Editing.Utils = (function() {
    function luceneEscape(text) {
        var newtext = text.replace(/[-[\]{}()*+?~:\\^!"]/g, "\\$&");
        return newtext.replace("&&", "\&&").replace("||", "\||");
    }

    return {
        luceneEscape: luceneEscape
    }
})();

MB.Referential = (function() {

    var RELATIONSHIP_TYPE_IDS = {
        'artist': {
            'work': {
                'composer': 168,
                'lyricist': 165
            }
        },
        'label': {
            'work': {
                'publisher': 'XXX'
            }
        }
    };

    var WORK_TYPES = {
         1: "Aria",
         2: "Ballet",
         3: "Cantata",
         4: "Concerto",
         5: "Sonata",
         6: "Suite",
         7: "Madrigal",
         8: "Mass",
         9: "Motet",
         10: "Opera",
         11: "Oratorio",
         12: "Overture",
         13: "Partita",
         14: "Quartet",
         15: "Song-cycle",
         16: "Symphony",
         17: "Song",
         18: "Symphonic poem",
         19: "Zarzuela",
         20: "Étude"
    };
    var WORK_TYPES_IDS = {};
    $.each(WORK_TYPES, function(id, name) { WORK_TYPES_IDS[name] = id; });

    return {
        RELATIONSHIPS: RELATIONSHIP_TYPE_IDS,
        WORK_TYPES_IDS: WORK_TYPES_IDS,
        WORK_TYPES: WORK_TYPES
    }

})();

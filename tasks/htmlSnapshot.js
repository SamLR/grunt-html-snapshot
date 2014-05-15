/*
 * grunt-html-snapshot
 *
 * Copyright (c) 2013 Christoph Burgdorf, contributors
 * Licensed under the MIT license.
 */
(function() {

'use strict';

module.exports = function(grunt) {

    var _           = require("lodash"),
        fs          = require("fs"),
        url         = require("url"),
        path        = require("path"),
        request     = require("request"),
        phantom     = require("grunt-lib-phantomjs").init(grunt),
        parseString = require("xml2js").parseString;

    var asset = path.join.bind(null, __dirname, '..');

    grunt.registerMultiTask('htmlSnapshot','fetch html snapshots', function(){

        var options = this.options({
          urls: [],
          msWaitForPages: 500,
          fileNamePrefix: 'snapshot_',
          sanitize: function(requestUri) {
            return requestUri.replace(/#|\/|\!/g, '_');
          },
          snapshotPath: '',
          sitePath: '',
          sitemapUrl: '',
          removeScripts: false,
          removeLinkTags: false,
          removeMetaTags: false,
          replaceStrings: [],
          rexclude: ''
        });

        var _urls = [];

        // the channel prefix for this async grunt task
        var taskChannelPrefix = "" + new Date().getTime();

        var sanitizeFilename = options.sanitize;

        var done = this.async();

        var isLastUrl = function(url){
            return _urls[_urls.length - 1] === url;
        };

        function getUrlsFromSitemap (_url, callback) {
            var urlList = [],
                unvisitedMaps = [],
                shouldExclude = function(toTest) {
                    // Returns true if the passed string matches the exclude regexp
                    var re = new RegExp(options.rexclude);
                    if (options.rexclude) {
                        return re.test(toTest);
                    } else {
                        return false;
                    }
                };

            request(_url, function (err, resp, body) {
                if (err  || !body) {
                    grunt.warn('error loading ' + _url + ': '+ err.message, 6);
                }
                parseString(body, function (err, res) {
                    var toWalk;

                    if ( err ) {
                        grunt.warn('error parsing ' + _url + ': '+ err.message, 6);

                    } else if ( res.sitemapindex ) {
                        toWalk = res.sitemapindex.sitemap;

                    } else if ( res.urlset ) {
                        toWalk = res.urlset.url;

                    } else {
                        grunt.warn('error: ' + _url + ' is not a valid urlset or sitemapindex', 6);
                    }

                    _.forEach(toWalk, function (item) {
                        var loc = item.loc[0]; // should be a full url
                        if ( res.urlset && !shouldExclude(loc) ) {
                            urlList.push( url.parse(loc).path );

                        } else if ( !shouldExclude(loc) ) {
                            unvisitedMaps.push(loc);

                            getUrlsFromSitemap(item.loc[0], function (urls) {
                                urlList = urlList.concat(urls);
                                _.pull(unvisitedMaps, loc);

                                // Make the callback once all the sitemaps
                                // have been visited
                                if (callback && unvisitedMaps.length === 0) {
                                    callback(urlList);
                                }
                            });
                        }
                    });

                    // If we're in a urlset we're finished so callback with
                    // the good news!
                    if ( res.urlset ) {
                        callback(urlList);
                    }
                });
            });
        }

        function snapshotUrls (urls) {
            _urls = urls;
            grunt.util.async.forEachSeries(_urls, function (urlToGet, next) {
                phantom.spawn(options.sitePath + urlToGet, {
                    // Additional PhantomJS options.
                    options: {
                        phantomScript: asset('phantomjs/bridge.js'),
                        msWaitForPages: options.msWaitForPages,
                        bodyAttr: options.bodyAttr,
                        cookies: options.cookies,
                        taskChannelPrefix: taskChannelPrefix
                    },
                    // Complete the task when done.
                    done: function (err) {
                        if (err) {
                            // If there was an error, abort the series.
                            done();
                        }
                        else {
                            // Otherwise, process next url.
                            next();
                        }
                    }
                });
            });
        }

        phantom.on(taskChannelPrefix + ".error.onError", function (msg, trace) {
            phantom.halt();
            grunt.warn('error: ' + msg, 6);
        });

        phantom.on(taskChannelPrefix + ".console", function (msg, trace) {
            grunt.log.writeln(msg);
        });

        phantom.on(taskChannelPrefix + ".htmlSnapshot.pageReady", function (msg, url) {
            var plainUrl = url.replace(options.sitePath, '');

            var fileName =  options.snapshotPath +
                            options.fileNamePrefix +
                            sanitizeFilename(plainUrl) +
                            '.html';

            if (options.removeScripts){
                msg = msg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            }

            if (options.removeLinkTags){
                msg = msg.replace(/<link\s.*?(\/)?>/gi, '');
            }

            if (options.removeMetaTags) {
                msg = msg.replace(/<meta\s.*?(\/)?>/gi, '');
            }

            options.replaceStrings.forEach(function (obj) {
                var key = Object.keys(obj);
                var value = obj[key];
                var regex = new RegExp(key, 'g');
                msg = msg.replace(regex, value);
            });

            grunt.file.write(fileName, msg);
            grunt.log.writeln(fileName, 'written');
            phantom.halt();

            if ( isLastUrl(plainUrl) ){
                 done();
            }
        });

        if (options.sitemapUrl) {
            getUrlsFromSitemap(options.sitemapUrl, function (urlList) {
                grunt.log.writeln('Finished scraping sitemap');
                snapshotUrls(urlList);
            });
        } else {
            snapshotUrls(options.urls);
        }
       
        grunt.log.writeln('running html-snapshot task...hold your horses');
    });
};

}());

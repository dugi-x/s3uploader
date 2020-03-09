/*
 * s3Uploader - jQuery Ajax File Uploader for s3 service (or compatible)
 * https://github.com/dugi-x/s3uploader
 *
 * Released under the MIT license.
 * inspired by dmUploader (https://github.com/danielm/uploade)
 *
 */

(function (factory) {
    "use strict";
    if (typeof define === "function" && define.amd) {
        define(["jquery"], factory);
    } else if (typeof exports !== "undefined") {
        module.exports = factory(require("jquery"));
    } else {
        factory(window.jQuery);
    }
}(function ($) {
    "use strict";

    var pluginName = "s3Uploader";

    var FileStatus = {
        PENDING: 0,
        READY: 1,
        UPLOADING: 2,
        COMPLETED: 3,
        FAILED: 4,
        CANCELLED: 5 //(by the user)
    };

    // These are the plugin defaults values
    var defaults = {
        url: document.URL, //Server URL to handle s3 api call
        autoStart: true,   //Files will start uploading right after they are get respone from handle s3 api call.
        multiple: true,    //Allows the user to select or drop multiple files at the same time.

        dnd: true,
        dndHookDocument: true,
        extraData: {},
        headers: {},

        fileMaxSize: 0,
        fileTypes: "*",
        fileExtFilter: null,

        onInit: function () { },

        onFallbackMode: function () { },
        onNewFile: function () { },        //params: id, file
        onReady: function () { },          //params: id
        onBeforeUpload: function () { },   //params: id
        onUploadProgress: function () { }, //params: id, percent
        onUploadSuccess: function () { },  //params: id, data
        onUploadCanceled: function () { }, //params: id
        onUploadError: function () { },    //params: id, xhr, status, message
        onUploadComplete: function () { }, //params: id

        onComplete: function () { },

        onFileTypeError: function () { },  //params: file
        onFileSizeError: function () { },  //params: file
        onFileExtError: function () { },   //params: file
        onFileReadyError: function () { }, //params: file

        onDragEnter: function () { },
        onDragLeave: function () { },
        onDocumentDragEnter: function () { },
        onDocumentDragLeave: function () { }
    };

    var S3UploaderFile = function (file, widget) {

        this.data = file;
        this.widget = widget;
        this.jqXHR = null;
        this.status = FileStatus.PENDING;
        this.id = Math.random().toString(36).substr(2);
        this.settings = {
            url: null,
            method: null,
            dataType: null,
            headers: [],
            contentType: null,
            fieldName: 'file'
        };

        if ((this.widget.settings.fileMaxSize > 0) && (file.size > this.widget.settings.fileMaxSize)) {

            this.status = FileStatus.FAILED;
            this.widget.settings.onFileSizeError.call(this.widget.element, file);
            return this;
        }

        // Check file type
        if ((this.widget.settings.fileTypes !== "*") && !file.type.match(this.widget.settings.fileTypes)) {

            this.status = FileStatus.FAILED;
            this.widget.settings.onFileTypeError.call(this.widget.element, file);
            return this;
        }

        // Check file extension
        if (this.widget.settings.fileExtFilter !== null) {
            var ext = file.name.toLowerCase().split(".").pop();

            if ($.inArray(ext, this.widget.settings.fileExtFilter) < 0) {

                this.status = FileStatus.FAILED;
                this.widget.settings.onFileExtError.call(this.widget.element, file);
                return this;
            }
        }


        return this;
    };

    S3UploaderFile.prototype.s3createPresignedRequest = function () {
        var File = this;

        if (!(File.status === FileStatus.PENDING || File.status === FileStatus.FAILED)) {

            return false;
        }

        var extraData = $.extend({}, File.widget.settings.extraData);
        extraData.fileInfo = {
            id: File.id,
            name: File.data.name,
            type: File.data.type,
            size: File.data.size,
            lastModified: File.data.lastModifiedDate
        }

        File.widget.activeFiles++;
        //File.widget.settings.headers - not in use
        $.post(File.widget.settings.url, extraData)
            .done(function (data) {

                if (data && data.url) {
                    File.settings = $.extend({}, File.settings, data);
                    File.status = FileStatus.READY;
                    File.widget.settings.onReady.call(File.widget.element, File.id);

                    //upload now or wait to command
                    if (File.widget.settings.autoStart) {

                        File.upload();
                    }

                    return true;
                }

                File.status = FileStatus.FAILED;
                File.widget.settings.onFileReadyError.call(File.widget.element, File.id, data);

            }).fail(function (jqXHR, textStatus, errorThrown) {

                File.status = FileStatus.FAILED;
                File.widget.settings.onFileReadyError.call(File.widget.element, File.id, errorThrown);
            }).always(function () {

                File.widget.activeFiles--;
                File.widget.processQueue(); //next
            });
    };

    S3UploaderFile.prototype.upload = function () {
        //We would like to add more uploaders later ..
        this.uploadFormData();
    };

    S3UploaderFile.prototype.uploadMultipart = function () {

        var File = this;

    };

    S3UploaderFile.prototype.uploadFormData = function () {
        var File = this;

        if (File.status !== FileStatus.READY) {
            //File not ready to upload yet?
            return false;
        }

        // Form Data
        var fd = new FormData();
        fd.append(File.settings.fieldName, File.data);

        File.status = FileStatus.UPLOADING;
        File.widget.activeFiles++;

        File.widget.settings.onBeforeUpload.call(File.widget.element, File.id);

        // Ajax Submit
        File.jqXHR = $.ajax({
            url: File.settings.url,
            type: File.settings.method,
            dataType: File.settings.dataType,
            data: fd,
            headers: File.settings.headers,
            cache: false,
            contentType: File.settings.contentType,
            processData: false,
            forceSync: false,
            xhr: function () { return File.getXhr(); },
        });

        File.jqXHR.done(function (data) {

            File.status = FileStatus.COMPLETED;
            File.widget.settings.onUploadSuccess.call(File.widget.element, File.id);

        }).fail(function (xhr, textStatus, errMsg) {

            if (File.status !== FileStatus.CANCELLED) {
                File.status = FileStatus.FAILED;
                File.widget.settings.onUploadError.call(File.widget.element, File.id, xhr, textStatus, errMsg);
            }

        }).always(function () {

            File.widget.activeFiles--;
            File.widget.processQueue(); //check for complete 
        });


    };

    S3UploaderFile.prototype.getXhr = function () {
        var File = this;
        var xhrobj = $.ajaxSettings.xhr();

        if (xhrobj.upload) {
            xhrobj.upload.addEventListener("progress", function (event) {
                var percent = 0;
                var position = event.loaded || event.position;
                var total = event.total || event.totalSize;

                if (event.lengthComputable) {
                    percent = Math.ceil(position / total * 100);
                }
                File.widget.settings.onUploadProgress.call(File.widget.element, File.id, percent);
            }, false);
        }

        return xhrobj;
    };

    S3UploaderFile.prototype.cancel = function (abort) {
        abort = (typeof abort === "undefined" ? false : abort);
        abort = abort || false;

        var myStatus = this.status;

        if (myStatus === FileStatus.UPLOADING || (abort && myStatus === FileStatus.PENDING)) {
            this.status = FileStatus.CANCELLED;
        } else {
            return false;
        }

        this.widget.settings.onUploadCanceled.call(this.widget.element, this.id);

        if (myStatus === FileStatus.UPLOADING) {
            this.jqXHR.abort();
        }

        return true;
    };


    var S3Uploader = function (element, options) {
        this.element = $(element);
        this.settings = $.extend({}, defaults, options);

        if (!this.checkSupport()) {
            $.error("Browser not supported by jQuery.s3Uploader");

            this.settings.onFallbackMode.call(this.element);

            return false;
        }

        this.init();

        return this;
    };

    S3Uploader.prototype.checkSupport = function () {
        // This one is mandatory for all modes
        if (typeof window.FormData === "undefined") {
            return false;
        }

        // Test based on: Modernizr/feature-detects/forms/fileinput.js
        var exp = new RegExp(
            "/(Android (1.0|1.1|1.5|1.6|2.0|2.1))|" +
            "(Windows Phone (OS 7|8.0))|(XBLWP)|" +
            "(ZuneWP)|(w(eb)?OSBrowser)|(webOS)|" +
            "(Kindle\/(1.0|2.0|2.5|3.0))/");

        if (exp.test(window.navigator.userAgent)) {
            return false;
        }

        return !$("<input type=\"file\" />").prop("disabled");
    };

    S3Uploader.prototype.init = function () {
        var widget = this;

        // Queue vars
        this.queue = [];
        this.queuePos = -1;
        this.queueRunning = false;
        this.activeFiles = 0;
        this.draggingOver = 0;
        this.draggingOverDoc = 0;

        var input = widget.element.is("input[type=file]") ?
            widget.element : widget.element.find("input[type=file]");

        //-- Is the input our main element itself??
        if (input.length > 0) {
            input.prop("multiple", this.settings.multiple);

            // Or does it has the input as a child
            input.on("change." + pluginName, function (evt) {
                var files = evt.target && evt.target.files;

                if (!files || !files.length) {
                    return;
                }

                widget.addFiles(files);

                $(this).val("");
            });
        }

        if (this.settings.dnd) {
            this.initDnD();
        }

        if (input.length === 0 && !this.settings.dnd) {
            // Trigger an error because if this happens the plugin wont do anything.
            $.error("Markup error found by jQuery.s3Uploader");

            return null;
        }

        // We good to go, tell them!
        this.settings.onInit.call(this.element);

        return this;
    };




    S3Uploader.prototype.addFiles = function (files) {
        var nFiles = 0;

        for (var i = 0; i < files.length; i++) {

            var File = new S3UploaderFile(files[i], this);
            if (File.status == FileStatus.FAILED) {
                continue;
            }

            
            var can_continue = this.settings.onNewFile.call(this.element, File.id, File.data);
            if (can_continue === false) {
                continue;
            }

            this.queue.push(File);

            nFiles++;
        }

        // No files were added
        if (nFiles === 0) {
            return this;
        }

        if (!this.queueRunning) {
            this.processQueue();
        }


        return this;
    };


    S3Uploader.prototype.processQueue = function () {
        this.queuePos++;

        if (this.queuePos >= this.queue.length) {

            if (this.activeFiles === 0) {
                //nothig to do
                //if autoStart == true upload is complete 
                //else upload ready to you
                this.settings.onComplete.call(this.element);
            }

            // Wait until new files are droped
            this.queuePos = (this.queue.length - 1);

            this.queueRunning = false;

            return false;
        }

        this.queueRunning = true;

        // Start next File.s3createPresignedRequest
        return this.queue[this.queuePos].s3createPresignedRequest();
    };

    S3Uploader.prototype.restartQueue = function () {
        this.queuePos = -1;
        this.queueRunning = false;

        this.processQueue();
    };

    S3Uploader.prototype.findById = function (id) {
        var r = false;

        for (var i = 0; i < this.queue.length; i++) {
            if (this.queue[i].id === id) {
                r = this.queue[i];
                break;
            }
        }

        return r;
    };

    S3Uploader.prototype.cancelAll = function () {
        this.queueRunning = false;

        // cancel 'em all
        for (var i = 0; i < this.queue.length; i++) {
            this.queue[i].cancel();
            this.queueRunning = false;
        }

    };

    S3Uploader.prototype.startAll = function () {
        for (var i = 0; i < this.queue.length; i++) {
            this.queue[i].upload();
        }
    };


    S3Uploader.prototype.initDnD = function () {
        var widget = this;

        // -- Now our own Drop
        widget.element.on("drop." + pluginName, function (evt) {
            evt.preventDefault();

            if (widget.draggingOver > 0) {
                widget.draggingOver = 0;
                widget.settings.onDragLeave.call(widget.element);
            }

            var dataTransfer = evt.originalEvent && evt.originalEvent.dataTransfer;
            if (!dataTransfer || !dataTransfer.files || !dataTransfer.files.length) {
                return;
            }

            // Take only the first file if not acepting multiple, this is kinda ugly. Needs Review ?
            var files = [];

            if (widget.settings.multiple) {
                files = dataTransfer.files;
            } else {
                files.push(dataTransfer.files[0]);
            }

            widget.addFiles(files);
        });

        //-- These two events/callbacks are onlt to maybe do some fancy visual stuff
        widget.element.on("dragenter." + pluginName, function (evt) {
            evt.preventDefault();

            if (widget.draggingOver === 0) {
                widget.settings.onDragEnter.call(widget.element);
            }

            widget.draggingOver++;
        });

        widget.element.on("dragleave." + pluginName, function (evt) {
            evt.preventDefault();

            widget.draggingOver--;

            if (widget.draggingOver === 0) {
                widget.settings.onDragLeave.call(widget.element);
            }
        });

        if (!widget.settings.dndHookDocument) {
            return;
        }

        // Adding some off/namepacing to prevent some weird cases when people use multiple instances
        $(document).off("drop." + pluginName).on("drop." + pluginName, function (evt) {
            evt.preventDefault();

            if (widget.draggingOverDoc > 0) {
                widget.draggingOverDoc = 0;
                widget.settings.onDocumentDragLeave.call(widget.element);
            }
        });

        $(document).off("dragenter." + pluginName).on("dragenter." + pluginName, function (evt) {
            evt.preventDefault();

            if (widget.draggingOverDoc === 0) {
                widget.settings.onDocumentDragEnter.call(widget.element);
            }

            widget.draggingOverDoc++;
        });

        $(document).off("dragleave." + pluginName).on("dragleave." + pluginName, function (evt) {
            evt.preventDefault();

            widget.draggingOverDoc--;

            if (widget.draggingOverDoc === 0) {
                widget.settings.onDocumentDragLeave.call(widget.element);
            }
        });

        $(document).off("dragover." + pluginName).on("dragover." + pluginName, function (evt) {
            evt.preventDefault();
        });
    };

    S3Uploader.prototype.releaseEvents = function () {
        // Leave everyone ALONE ;_;

        this.element.off("." + pluginName);
        this.element.find("input[type=file]").off("." + pluginName);

        if (this.settings.dndHookDocument) {
            $(document).off("." + pluginName);
        }
    };



    // Public API methods
    S3Uploader.prototype.methods = {
        start: function (id) {
            var File = false;

            if (typeof id !== "undefined") {
                File = this.findById(id);

                if (!File) {
                    // File not found in stack
                    $.error("File not found in jQuery.s3Uploader");
                    return false;
                }
            }

            // Trying to Start an upload by ID
            if (File) {
                if (File.status === FileStatus.CANCELLED) {
                    File.status = FileStatus.READY;
                }
                return File.upload();
            }

            // With no id provided...

            this.startAll();

            return true;
        },
        cancel: function (id) {
            var File = false;
            if (typeof id !== "undefined") {
                File = this.findById(id);

                if (!File) {
                    // File not found in stack
                    $.error("File not found in jQuery.s3Uploader");

                    return false;
                }
            }

            if (File) {
                return File.cancel(true);
            }

            // With no id provided...

            this.cancelAll();

            return true;
        },
        reset: function () {

            this.cancelAll();

            return true;
        },
        destroy: function () {
            this.cancelAll();

            this.releaseEvents();

            this.element.removeData(pluginName);
        }
    };



    $.fn.s3Uploader = function (options) {
        var args = arguments;

        if (typeof options === "string") {
            this.each(function () {
                var plugin = $.data(this, pluginName);

                if (plugin instanceof S3Uploader) {
                    if (typeof plugin.methods[options] === "function") {
                        plugin.methods[options].apply(plugin, Array.prototype.slice.call(args, 1));
                    } else {
                        $.error("Method " + options + " does not exist in jQuery.s3Uploader");
                    }
                } else {
                    $.error("Unknown plugin data found by jQuery.s3Uploader");
                }
            });
        } else {
            return this.each(function () {
                if (!$.data(this, pluginName)) {
                    $.data(this, pluginName, new S3Uploader(this, options));
                }
            });
        }
    };
}));
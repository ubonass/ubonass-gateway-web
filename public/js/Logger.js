
function noop() {

}
/**
 *
 * @param options
 * @constructor
 */
function Logger(options) {

    if (options === undefined || options === null)
        options = options || {};

    if (options.debug === undefined || options.debug == null)
        options.debug = {debug: ["error", "warn", "log"]};

    if (typeof console == "undefined" || typeof console.log == "undefined")
        console = {
            log: function () {
            }
        };
    console.log("start new Logger");
    this.trace = noop;
    this.debug = noop;
    this.vdebug = noop;
    this.log = noop;
    this.warn = noop;
    this.error = noop;
    if (options.debug === true || options.debug === "all") {
        // Enable all debugging levels
        this.trace = console.trace.bind(console);
        this.debug = console.debug.bind(console);
        this.vdebug = console.debug.bind(console);
        this.log = console.log.bind(console);
        this.warn = console.warn.bind(console);
        this.error = console.error.bind(console);

    } else if (Array.isArray(options.debug)) {
        for (var i in options.debug) {
            var d = options.debug[i];
            switch (d) {
                case "trace":
                    this.trace = console.trace.bind(console);
                    break;
                case "debug":
                    this.debug = console.debug.bind(console);
                    break;
                case "vdebug":
                    this.vdebug = console.debug.bind(console);
                    break;
                case "log":
                    this.log = console.log.bind(console);
                    break;
                case "warn":
                    this.warn = console.warn.bind(console);
                    break;
                case "error":
                    this.error = console.error.bind(console);
                    break;
                default:
                    console.error("Unknown debugging option '" + d +
                        "' (supported: 'trace', 'debug', 'vdebug', 'log', warn', 'error')");
                    break;
            }
        }
    }
}

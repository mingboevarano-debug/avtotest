(function () {
    "use strict";

    // Disable right-click context menu
    document.addEventListener("contextmenu", function (e) {
        e.preventDefault();
    });

    // Disable DevTools / inspect shortcuts
    document.addEventListener("keydown", function (e) {
        // F12
        if (e.key === "F12") {
            e.preventDefault();
            return false;
        }
        // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect), Ctrl+U (View source)
        if (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) {
            e.preventDefault();
            return false;
        }
        if (e.ctrlKey && e.key === "u") {
            e.preventDefault();
            return false;
        }
        // Cmd+Option+I, Cmd+Option+J, Cmd+Option+C (Mac)
        if (e.metaKey && e.altKey && ["i", "j", "I", "J", "c", "C"].includes(e.key)) {
            e.preventDefault();
            return false;
        }
    });
})();

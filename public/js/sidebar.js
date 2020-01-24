// Event fired when the sidebar is shown
$(document).on('shown.lte.pushmenu',function(){
    // Show the agent status dropdown in the sidebar
    $("#status-dropdown").show()
    //Enlarge the user image in the sidebar
    $("#sidebar-user-image").animate({width:50}, 250)

    // Show all of the caption settings
    $("#cap-font-size").show()
    $("#cap-font-color").show()
    $("#cap-bg-color").show()
    $("#demo-btn-container").show()
})
// Event fired when the sidebar collapses
$(document).on('collapsed.lte.pushmenu',function(){
    // Hide the agent status dropdown
    $("#status-dropdown").hide()
    // Shrink the size of the agent user image in the sidebar
    $("#sidebar-user-image").animate({width:34}, 250)
    // Hide all of the caption settings
    $("#cap-font-size").hide()
    $("#cap-font-color").hide()
    $("#cap-bg-color").hide()
    $("#demo-btn-container").hide()
})



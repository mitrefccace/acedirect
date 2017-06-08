function Busylight(configs) {
    this.statusCd = {};
    this.updateConfigs(configs);
}

Busylight.prototype.updateConfigs = function (configs) {
    this.statusCd = {};
    for (var i in configs) {
        this.statusCd[configs[i].id] = configs[i]
    }
}

Busylight.prototype.light = function (status) {
    switch (status) {
        case 'OFF_DUTY':
            PostLightCode(this.statusCd.off_duty);
            break;
        case 'AWAY':
            PostLightCode(this.statusCd.away);
            break;
        case 'READY':
            PostLightCode(this.statusCd.ready);
            break;
        case 'IN_CALL':
            PostLightCode(this.statusCd.in_call);
            break;
        case 'HOLD':
            PostLightCode(this.statusCd.hold);
            break;
        case 'INCOMING_CALL':
            PostLightCode(this.statusCd.incoming_call);
            break;
        case 'TRANSFERRED_CALL':
            PostLightCode(this.statusCd.transferred_call);
            break;
        case 'WRAP_UP':
            PostLightCode(this.statusCd.wrap_up);
            break;
        case 'NEED_ASSISTANCE':
            PostLightCode(this.statusCd.need_assistance);
            break;
        case 'MISSED_CALL':
            PostLightCode(this.statusCd.missed_call);
            break;
        default:
            PostLightCode({
                "id": 'off',
                "r": 0,
                "g": 0,
                "b": 0,
                "blink": false,
                "stop": true
            });
    }
}

function PostLightCode(color) {
    var lightcode = {
        "id": 'off',
        "r": 0,
        "g": 0,
        "b": 0,
        "blink": false,
        "stop": true
    };

    if (typeof color !== 'undefined') {
        lightcode = {
            "status": color.id,
            "r": color.r,
            "g": color.g,
            "b": color.b,
            "blink": color.blink,
            "stop": color.stop
        };
    }
    $.post('https://localhost:6298/setbusylight', JSON.stringify(lightcode));
}
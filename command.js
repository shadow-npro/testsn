// command.js
const commands = [];

class Command {
    constructor(pattern, desc, type = "general", handler) {
        this.pattern = pattern;
        this.desc = desc;
        this.type = type;
        this.handler = handler;

        // Add to global commands array
        commands.push(this);
        console.log(`📝 Registered command: ${pattern}`);
    }
}

function cmd(pattern, desc, type = "general") {
    return function(handler) {
        return new Command(pattern, desc, type, handler);
    };
}

// Function to get all registered commands
function getCommands() {
    return commands;
}

// Function to find matching command
function findCommand(text) {
    return commands.find(cmd => {
        if (cmd.pattern instanceof RegExp) {
            return cmd.pattern.test(text);
        }
        return text.includes(cmd.pattern);
    });
}

module.exports = { 
    Command,
    cmd,
    getCommands,
    findCommand
};
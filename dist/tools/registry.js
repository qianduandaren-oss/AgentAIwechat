export class ToolRegistry {
    tools = new Map();
    register(definition, handler) {
        this.tools.set(definition.name, { definition, handler });
    }
    listDefinitions() {
        return [...this.tools.values()].map(item => item.definition);
    }
    get(name) {
        return this.tools.get(name);
    }
}

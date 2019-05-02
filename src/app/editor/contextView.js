'use strict'
const yo = require('yo-yo')
const remixLib = require('remix-lib')
const SourceMappingDecoder = remixLib.SourceMappingDecoder
const globalRegistry = require('../../global/registry')

const css = require('./styles/contextView-styles')

/*
  Display information about the current focused code:
   - if it's a reference, display information about the declaration
   - jump to the declaration
   - number of references
   - rename declaration/references
*/
class ContextView {
  constructor (opts, localRegistry) {
    this._components = {}
    this._components.registry = localRegistry || globalRegistry
    this.contextualListener = opts.contextualListener
    this.editor = opts.editor
    this._deps = {
      compilersArtefacts: this._components.registry.get('compilersartefacts').api,
      offsetToLineColumnConverter: this._components.registry.get('offsettolinecolumnconverter').api,
      config: this._components.registry.get('config').api,
      fileManager: this._components.registry.get('filemanager').api
    }
    this._view
    this._nodes
    this._current
    this.sourceMappingDecoder = new SourceMappingDecoder()
    this.previousElement = null
    this.contextualListener.event.register('contextChanged', nodes => {
      this.show()
      this._nodes = nodes
      this.update()
    })
    this.contextualListener.event.register('stopHighlighting', () => {
      this.hide()
    })
  }

  render () {
    const view = yo`<div class="${css.contextview} ${css.contextviewcontainer} badge badge-info font-weight-bold border-top-0">
      <div class=${css.container}>
        ${this._renderTarget()}
      </div>
    </div>`
    if (!this._view) {
      this._view = view
      this.hide()
    }
    return view
  }

  hide () {
    if (this._view) {
      this._view.style.display = 'none'
    }
  }

  show () {
    if (this._view) {
      this._view.style.display = 'block'
    }
  }

  update () {
    if (this._view) {
      yo.update(this._view, this.render())
      this._view.style.display = this._current ? 'block' : 'none'
    }
  }

  _renderTarget () {
    let last
    const previous = this._current
    if (this._nodes && this._nodes.length) {
      last = this._nodes[this._nodes.length - 1]
      if (isDefinition(last)) {
        this._current = last
      } else {
        const target = this.contextualListener.declarationOf(last)
        if (target) {
          this._current = target
        } else {
          this._current = null
        }
      }
    }
    if (!this._current || !previous || previous.id !== this._current.id) {
      this.previousElement = this._render(this._current, last)
    }
    return this.previousElement
  }

  _jumpToInternal (position) {
    const jumpToLine = (lineColumn) => {
      if (lineColumn.start && lineColumn.start.line && lineColumn.start.column) {
        this.editor.gotoLine(lineColumn.start.line, lineColumn.end.column + 1)
      }
    }
    let lastCompilationResult = this._deps.compilersArtefacts['__last']
    if (lastCompilationResult && lastCompilationResult.languageversion.indexOf('soljson') === 0 && lastCompilationResult.data) {
      const lineColumn = this._deps.offsetToLineColumnConverter.offsetToLineColumn(
        position,
        position.file,
        lastCompilationResult.getSourceCode().sources,
        lastCompilationResult.getAsts())
      const filename = lastCompilationResult.getSourceName(position.file)
      // TODO: refactor with rendererAPI.errorClick
      if (filename !== this._deps.config.get('currentFile')) {
        const provider = this._deps.fileManager.fileProviderOf(filename)
        if (provider) {
          provider.exists(filename, (error, exist) => {
            if (error) return console.log(error)
            this._deps.fileManager.switchFile(filename)
            jumpToLine(lineColumn)
          })
        }
      } else {
        jumpToLine(lineColumn)
      }
    }
  }

  _render (node, nodeAtCursorPosition) {
    if (!node) return yo`<div></div>`
    let references = this.contextualListener.referencesOf(node)
    const type = (node.attributes && node.attributes.type) ? node.attributes.type : node.name
    references = `${references ? references.length : '0'} reference(s)`

    let ref = 0
    const nodes = this.contextualListener.getActiveHighlights()
    for (const k in nodes) {
      if (nodeAtCursorPosition.id === nodes[k].nodeId) {
        ref = k
        break
      }
    }

    // JUMP BETWEEN REFERENCES
    const jump = (e) => {
      e.target.dataset.action === 'next' ? ref++ : ref--
      if (ref < 0) ref = nodes.length - 1
      if (ref >= nodes.length) ref = 0
      this._jumpToInternal(nodes[ref].position)
    }

    const jumpTo = () => {
      if (node && node.src) {
        const position = this.sourceMappingDecoder.decode(node.src)
        if (position) {
          this._jumpToInternal(position)
        }
      }
    }

    const showGasEstimation = () => {
      if (node.name === 'FunctionDefinition') {
        const result = this.contextualListener.gasEstimation(node)
        const executionCost = 'Execution cost: ' + result.executionCost + ' gas'
        const codeDepositCost = 'Code deposit cost: ' + result.codeDepositCost + ' gas'
        const estimatedGas = result.codeDepositCost ? `${codeDepositCost}, ${executionCost}` : `${executionCost}`
        return yo`<div class=${css.gasEstimation}>
        <img class=${css.gasStationIcon} title='Gas estimation' src='assets/img/gasStation_50.png'>
        ${estimatedGas}
        </div>`
      }
    }

    return yo`<div class=${css.line}>
      <div title=${type} class=${css.type}>${type}</div>
      <div title=${node.attributes.name} class=${css.name}>${node.attributes.name}</div>
      <i class="fas fa-share ${css.jump}" aria-hidden="true" onclick=${jumpTo}></i>
      <span class=${css.referencesnb}>${references}</span>
      <i data-action='previous' class="fas fa-chevron-up ${css.jump}" aria-hidden="true" onclick=${jump}></i>
      <i data-action='next' class="fas fa-chevron-down ${css.jump}" aria-hidden="true" onclick=${jump}></i>
        ${showGasEstimation()}
    </div>`
  }
}

function isDefinition (node) {
  return node.name === 'ContractDefinition' ||
  node.name === 'FunctionDefinition' ||
  node.name === 'ModifierDefinition' ||
  node.name === 'VariableDeclaration' ||
  node.name === 'StructDefinition' ||
  node.name === 'EventDefinition'
}

module.exports = ContextView

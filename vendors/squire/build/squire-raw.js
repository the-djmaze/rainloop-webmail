/* Copyright © 2011-2015 by Neil Jenkins. MIT Licensed. */
/* eslint max-len: 0 */

/**
	TODO: modifyBlocks function doesn't work very good.
	For example you have: UL > LI > [cursor here in text]
	Then create blockquote at cursor, the result is: BLOCKQUOTE > UL > LI
	not UL > LI > BLOCKQUOTE
*/

( doc => {

const
	DOCUMENT_POSITION_PRECEDING = 2, // Node.DOCUMENT_POSITION_PRECEDING
	ELEMENT_NODE = 1,                // Node.ELEMENT_NODE,
	TEXT_NODE = 3,                   // Node.TEXT_NODE,
	DOCUMENT_NODE = 9,               // Node.DOCUMENT_NODE,
	DOCUMENT_FRAGMENT_NODE = 11,     // Node.DOCUMENT_FRAGMENT_NODE,
	SHOW_ELEMENT = 1,                // NodeFilter.SHOW_ELEMENT,
	SHOW_TEXT = 4,                   // NodeFilter.SHOW_TEXT,

	START_TO_START = 0, // Range.START_TO_START
	START_TO_END = 1,   // Range.START_TO_END
	END_TO_END = 2,     // Range.END_TO_END
	END_TO_START = 3,   // Range.END_TO_START

	ZWS = '\u200B',
	NBSP = '\u00A0',

	win = doc.defaultView,

	ua = navigator.userAgent,

	isMac = /Mac OS X/.test( ua ),
	isWin = /Windows NT/.test( ua ),
	isIOS = /iP(?:ad|hone|od)/.test( ua ) || ( isMac && !!navigator.maxTouchPoints ),

	isGecko = /Gecko\//.test( ua ),
	isEdge = /Edge\//.test( ua ),
	isWebKit = !isEdge && /WebKit\//.test( ua ),

	ctrlKey = isMac ? 'meta-' : 'ctrl-',
	osKey = isMac ? 'metaKey' : 'ctrlKey',

	// Use [^ \t\r\n] instead of \S so that nbsp does not count as white-space
	notWS = /[^ \t\r\n]/,

	indexOf = (array, value) => Array.prototype.indexOf.call(array, value),

	typeToBitArray = {
		// ELEMENT_NODE
		1: 1,
		// ATTRIBUTE_NODE
		2: 2,
		// TEXT_NODE
		3: 4,
		// COMMENT_NODE
		8: 128,
		// DOCUMENT_NODE
		9: 256,
		// DOCUMENT_FRAGMENT_NODE
		11: 1024
	},

	inlineNodeNames = /^(?:#text|A|ABBR|ACRONYM|B|BR|BD[IO]|CITE|CODE|DATA|DEL|DFN|EM|FONT|HR|IMG|INPUT|INS|KBD|Q|RP|RT|RUBY|SAMP|SMALL|SPAN|STR(IKE|ONG)|SU[BP]|TIME|U|VAR|WBR)$/,
//	phrasingElements = 'ABBR,AUDIO,B,BDO,BR,BUTTON,CANVAS,CITE,CODE,COMMAND,DATA,DATALIST,DFN,EM,EMBED,I,IFRAME,IMG,INPUT,KBD,KEYGEN,LABEL,MARK,MATH,METER,NOSCRIPT,OBJECT,OUTPUT,PROGRESS,Q,RUBY,SAMP,SCRIPT,SELECT,SMALL,SPAN,STRONG,SUB,SUP,SVG,TEXTAREA,TIME,VAR,VIDEO,WBR',

	leafNodeNames = {
		BR: 1,
		HR: 1,
		IMG: 1
	},

	UNKNOWN = 0,
	INLINE = 1,
	BLOCK = 2,
	CONTAINER = 3,

	isLeaf = node => node.nodeType === ELEMENT_NODE && !!leafNodeNames[ node.nodeName ],

	getNodeCategory = node => {
		switch ( node.nodeType ) {
		case TEXT_NODE:
			return INLINE;
		case ELEMENT_NODE:
		case DOCUMENT_FRAGMENT_NODE:
			if ( nodeCategoryCache.has( node ) ) {
				return nodeCategoryCache.get( node );
			}
			break;
		default:
			return UNKNOWN;
		}

		let nodeCategory;
		if ( !Array.prototype.every.call( node.childNodes, isInline ) ) {
			// Malformed HTML can have block tags inside inline tags. Need to treat
			// these as containers rather than inline. See #239.
			nodeCategory = CONTAINER;
		} else if ( inlineNodeNames.test( node.nodeName ) ) {
			nodeCategory = INLINE;
		} else /*if ( blockElementNames.test( node.nodeName ) )*/ {
			nodeCategory = BLOCK;
		}
		nodeCategoryCache.set( node, nodeCategory );
		return nodeCategory;
	},
	isInline = node => getNodeCategory( node ) === INLINE,
	isBlock = node => getNodeCategory( node ) === BLOCK,
	isContainer = node => getNodeCategory( node ) === CONTAINER,
	getBlockWalker = ( node, root ) => {
		let walker = doc.createTreeWalker( root, SHOW_ELEMENT, isBlock );
		walker.currentNode = node;
		return walker;
	},
	getPreviousBlock = ( node, root ) => {
//		node = getClosest( node, root, blockElementNames );
		node = getBlockWalker( node, root ).previousNode();
		return node !== root ? node : null;
	},
	getNextBlock = ( node, root ) => {
//		node = getClosest( node, root, blockElementNames );
		node = getBlockWalker( node, root ).nextNode();
		return node !== root ? node : null;
	},

	isEmptyBlock = block => !block.textContent && !block.querySelector( 'IMG' ),

	areAlike = ( node, node2 ) => {
		return !isLeaf( node ) && (
			node.nodeType === node2.nodeType &&
			node.nodeName === node2.nodeName &&
			node.nodeName !== 'A' &&
			node.className === node2.className &&
			( ( !node.style && !node2.style ) ||
			  node.style.cssText === node2.style.cssText )
		);
	},
	hasTagAttributes = ( node, tag, attributes ) => {
		if ( node.nodeName !== tag ) {
			return false;
		}
		for ( let attr in attributes ) {
			if ( node.getAttribute( attr ) !== attributes[ attr ] ) {
				return false;
			}
		}
		return true;
	},
	getClosest = ( node, root, selector ) => {
		node = (!node || node.closest ? node : node.parentElement);
		node = node && node.closest(selector);
		return (node && root.contains(node)) ? node : null;
	},
	getNearest = ( node, root, tag, attributes ) => {
		while ( node && node !== root ) {
			if ( hasTagAttributes( node, tag, attributes ) ) {
				return node;
			}
			node = node.parentNode;
		}
		return null;
	},

	getPath = ( node, root, config ) => {
		let path = '', classNames, styleNames;
		if ( node && node !== root ) {
			path = getPath( node.parentNode, root, config );
			if ( node.nodeType === ELEMENT_NODE ) {
				path += ( path ? '>' : '' ) + node.nodeName;
				if ( node.id ) {
					path += '#' + node.id;
				}
				if ( node.classList.length ) {
					classNames = [...node.classList].sort();
					path += '.' + classNames.join( '.' );
				}
				if ( node.dir ) {
					path += '[dir=' + node.dir + ']';
				}
				if ( classNames ) {
					styleNames = config.classNames;
					if ( classNames.includes( styleNames.highlight ) ) {
						path += '[backgroundColor=' +
							node.style.backgroundColor.replace( / /g,'' ) + ']';
					}
					if ( classNames.includes( styleNames.colour ) ) {
						path += '[color=' +
							node.style.color.replace( / /g,'' ) + ']';
					}
					if ( classNames.includes( styleNames.fontFamily ) ) {
						path += '[fontFamily=' +
							node.style.fontFamily.replace( / /g,'' ) + ']';
					}
					if ( classNames.includes( styleNames.fontSize ) ) {
						path += '[fontSize=' + node.style.fontSize + ']';
					}
				}
			}
		}
		return path;
	},

	getLength = node => {
		let nodeType = node.nodeType;
		return nodeType === ELEMENT_NODE || nodeType === DOCUMENT_FRAGMENT_NODE ?
			node.childNodes.length : node.length || 0;
	},

	empty = node => {
		let frag = doc.createDocumentFragment(),
			childNodes = node.childNodes;
		childNodes && frag.append( ...childNodes );
		return frag;
	},

	createElement = ( doc, tag, props, children ) => {
		let el = doc.createElement( tag ),
			attr, value;
		if ( props instanceof Array ) {
			children = props;
			props = null;
		}
		if ( props ) {
			for ( attr in props ) {
				value = props[ attr ];
				if ( value !== undefined ) {
					el.setAttribute( attr, value );
				}
			}
		}
		children && el.append( ...children );
		return el;
	},

	fixCursor = ( node, root ) => {
		// In Webkit and Gecko, block level elements are collapsed and
		// unfocusable if they have no content (:empty). To remedy this, a <BR> must be
		// inserted. In Opera and IE, we just need a textnode in order for the
		// cursor to appear.
		let self = root.__squire__;
		let originalNode = node;
		let fixer, child;

		if ( node === root ) {
			if ( !( child = node.firstChild ) || child.nodeName === 'BR' ) {
				fixer = self.createDefaultBlock();
				if ( child ) {
					child.replaceWith( fixer );
				}
				else {
					node.append( fixer );
				}
				node = fixer;
				fixer = null;
			}
		}

		if ( node.nodeType === TEXT_NODE ) {
			return originalNode;
		}

		if ( isInline( node ) ) {
			child = node.firstChild;
			while ( isWebKit && child &&
					child.nodeType === TEXT_NODE && !child.data ) {
				child.remove(  );
				child = node.firstChild;
			}
			if ( !child ) {
				if ( isWebKit ) {
					fixer = doc.createTextNode( ZWS );
					self._didAddZWS();
				} else {
					fixer = doc.createTextNode( '' );
				}
			}
//		} else if ( !node.querySelector( 'BR' ) ) {
		} else if ( node.matches( ':empty' ) ) {
			fixer = createElement( doc, 'BR' );
			while ( ( child = node.lastElementChild ) && !isInline( child ) ) {
				node = child;
			}
		}
		if ( fixer ) {
			try {
				node.append( fixer );
			} catch ( error ) {
				self.didError({
					name: 'Squire: fixCursor – ' + error,
					message: 'Parent: ' + node.nodeName + '/' + node.innerHTML +
						' appendChild: ' + fixer.nodeName
				});
			}
		}

		return originalNode;
	},

	// Recursively examine container nodes and wrap any inline children.
	fixContainer = ( container, root ) => {
		let children = container.childNodes;
		let wrapper = null;
		let i, l, child, isBR;

		for ( i = 0, l = children.length; i < l; ++i ) {
			child = children[i];
			isBR = child.nodeName === 'BR';
			if ( !isBR && isInline( child )
//			 && (root.__squire__._config.blockTag !== 'DIV' || (child.matches && !child.matches(phrasingElements)))
			) {
				if ( !wrapper ) {
					 wrapper = createElement( doc, 'div' );
				}
				wrapper.append( child );
				--i;
				--l;
			} else if ( isBR || wrapper ) {
				if ( !wrapper ) {
					wrapper = createElement( doc, 'div' );
				}
				fixCursor( wrapper, root );
				if ( isBR ) {
					child.replaceWith( wrapper );
				} else {
					child.before( wrapper  );
					++i;
					++l;
				}
				wrapper = null;
			}
			if ( isContainer( child ) ) {
				fixContainer( child, root );
			}
		}
/*
		// Not live
		[...container.children].forEach(child => {
			isBR = child.nodeName === 'BR';
			if ( !isBR && isInline( child )
//			 && (root.__squire__._config.blockTag !== 'DIV' || (child.matches && !child.matches(phrasingElements)))
			) {
				if ( !wrapper ) {
					 wrapper = createElement( doc, 'div' );
				}
				wrapper.append( child );
			} else if ( isBR || wrapper ) {
				if ( !wrapper ) {
					wrapper = createElement( doc, 'div' );
				}
				fixCursor( wrapper, root );
				if ( isBR ) {
					child.replaceWith( wrapper );
				} else {
					child.before( wrapper  );
				}
				wrapper = null;
			}
			if ( isContainer( child ) ) {
				fixContainer( child, root );
			}
		});
*/
		if ( wrapper ) {
			container.append( fixCursor( wrapper, root ) );
		}
		return container;
	},

	split = ( node, offset, stopNode, root ) => {
		let nodeType = node.nodeType,
			parent, clone, next;
		if ( nodeType === TEXT_NODE && node !== stopNode ) {
			return split(
				node.parentNode, node.splitText( offset ), stopNode, root );
		}
		if ( nodeType === ELEMENT_NODE ) {
			if ( typeof( offset ) === 'number' ) {
				offset = offset < node.childNodes.length ?
					node.childNodes[ offset ] : null;
			}
			if ( node === stopNode ) {
				return offset;
			}

			// Clone node without children
			parent = node.parentNode;
			clone = node.cloneNode( false );

			// Add right-hand siblings to the clone
			while ( offset ) {
				next = offset.nextSibling;
				clone.append( offset );
				offset = next;
			}

			// Maintain li numbering if inside a quote.
			if ( node.nodeName === 'OL' &&
					getClosest( node, root, 'BLOCKQUOTE' ) ) {
				clone.start = ( +node.start || 1 ) + node.childNodes.length - 1;
			}

			// DO NOT NORMALISE. This may undo the fixCursor() call
			// of a node lower down the tree!

			// We need something in the element in order for the cursor to appear.
			fixCursor( node, root );
			fixCursor( clone, root );

			// Inject clone after original node
			node.after( clone );

			// Keep on splitting up the tree
			return split( parent, clone, stopNode, root );
		}
		return offset;
	},

	_mergeInlines = ( node, fakeRange ) => {
		let children = node.childNodes,
			l = children.length,
			frags = [],
			child, prev;
		while ( l-- ) {
			child = children[l];
			prev = l && children[ l - 1 ];
			if ( l && isInline( child ) && areAlike( child, prev ) &&
					!leafNodeNames[ child.nodeName ] ) {
				if ( fakeRange.startContainer === child ) {
					fakeRange.startContainer = prev;
					fakeRange.startOffset += getLength( prev );
				}
				if ( fakeRange.endContainer === child ) {
					fakeRange.endContainer = prev;
					fakeRange.endOffset += getLength( prev );
				}
				if ( fakeRange.startContainer === node ) {
					if ( fakeRange.startOffset > l ) {
						--fakeRange.startOffset;
					}
					else if ( fakeRange.startOffset === l ) {
						fakeRange.startContainer = prev;
						fakeRange.startOffset = getLength( prev );
					}
				}
				if ( fakeRange.endContainer === node ) {
					if ( fakeRange.endOffset > l ) {
						--fakeRange.endOffset;
					}
					else if ( fakeRange.endOffset === l ) {
						fakeRange.endContainer = prev;
						fakeRange.endOffset = getLength( prev );
					}
				}
				child.remove();
				if ( child.nodeType === TEXT_NODE ) {
					prev.appendData( child.data );
				}
				else {
					frags.push( empty( child ) );
				}
			}
			else if ( child.nodeType === ELEMENT_NODE ) {
				child.append(...frags.reverse());
				frags = [];
				_mergeInlines( child, fakeRange );
			}
		}
	},

	mergeInlines = ( node, range ) => {
		if ( node.nodeType === TEXT_NODE ) {
			node = node.parentNode;
		}
		if ( node.nodeType === ELEMENT_NODE ) {
			let fakeRange = {
				startContainer: range.startContainer,
				startOffset: range.startOffset,
				endContainer: range.endContainer,
				endOffset: range.endOffset
			};
			_mergeInlines( node, fakeRange );
			range.setStart( fakeRange.startContainer, fakeRange.startOffset );
			range.setEnd( fakeRange.endContainer, fakeRange.endOffset );
		}
	},

	mergeWithBlock = ( block, next, range, root ) => {
		let container = next;
		let parent, last, offset;
		while ( ( parent = container.parentNode ) &&
				parent !== root &&
				parent.nodeType === ELEMENT_NODE &&
				parent.childNodes.length === 1 ) {
			container = parent;
		}
//		container.remove(); // not a function?
		container.parentNode && container.parentNode.removeChild( container );

		offset = block.childNodes.length;

		// Remove extra <BR> fixer if present.
		last = block.lastChild;
		if ( last && last.nodeName === 'BR' ) {
			last.remove(  );
			--offset;
		}

		block.append( empty( next ) );

		range.setStart( block, offset );
		range.collapse( true );
		mergeInlines( block, range );
	},

	mergeContainers = ( node, root ) => {
		let prev = node.previousSibling,
			first = node.firstChild,
			isListItem = ( node.nodeName === 'LI' ),
			needsFix, block;

		// Do not merge LIs, unless it only contains a UL
		if ( isListItem && ( !first || !/^[OU]L$/.test( first.nodeName ) ) ) {
			return;
		}

		if ( prev && areAlike( prev, node ) ) {
			if ( !isContainer( prev ) ) {
				if ( isListItem ) {
					block = createElement( doc, 'DIV' );
					block.append( empty( prev ) );
					prev.append( block );
				} else {
					return;
				}
			}
			node.remove();
			needsFix = !isContainer( node );
			prev.append( empty( node ) );
			if ( needsFix ) {
				fixContainer( prev, root );
			}
			if ( first ) {
				mergeContainers( first, root );
			}
		} else if ( isListItem ) {
			prev = createElement( doc, 'DIV' );
			node.insertBefore( prev, first );
			fixCursor( prev, root );
		}
	},

	getNodeBefore = ( node, offset ) => {
		let children = node.childNodes;
		while ( offset && node.nodeType === ELEMENT_NODE ) {
			node = children[ offset - 1 ];
			children = node.childNodes;
			offset = children.length;
		}
		return node;
	},

	getNodeAfter = ( node, offset ) => {
		if ( node.nodeType === ELEMENT_NODE ) {
			let children = node.childNodes;
			if ( offset < children.length ) {
				node = children[ offset ];
			} else {
				while ( node && !node.nextSibling ) {
					node = node.parentNode;
				}
				if ( node ) { node = node.nextSibling; }
			}
		}
		return node;
	},

	insertNodeInRange = ( range, node ) => {
		// Insert at start.
		let startContainer = range.startContainer,
			startOffset = range.startOffset,
			endContainer = range.endContainer,
			endOffset = range.endOffset,
			parent, children, childCount, afterSplit;

		// If part way through a text node, split it.
		if ( startContainer.nodeType === TEXT_NODE ) {
			parent = startContainer.parentNode;
			children = parent.childNodes;
			if ( startOffset === startContainer.length ) {
				startOffset = indexOf( children, startContainer ) + 1;
				if ( range.collapsed ) {
					endContainer = parent;
					endOffset = startOffset;
				}
			} else {
				if ( startOffset ) {
					afterSplit = startContainer.splitText( startOffset );
					if ( endContainer === startContainer ) {
						endOffset -= startOffset;
						endContainer = afterSplit;
					}
					else if ( endContainer === parent ) {
						++endOffset;
					}
					startContainer = afterSplit;
				}
				startOffset = indexOf( children, startContainer );
			}
			startContainer = parent;
		} else {
			children = startContainer.childNodes;
		}

		childCount = children.length;

		if ( startOffset === childCount ) {
			startContainer.append( node );
		} else {
			startContainer.insertBefore( node, children[ startOffset ] );
		}

		if ( startContainer === endContainer ) {
			endOffset += children.length - childCount;
		}

		range.setStart( startContainer, startOffset );
		range.setEnd( endContainer, endOffset );
	},

	extractContentsOfRange = ( range, common, root ) => {
		let startContainer = range.startContainer,
			startOffset = range.startOffset,
			endContainer = range.endContainer,
			endOffset = range.endOffset;

		if ( !common ) {
			common = range.commonAncestorContainer;
		}

		if ( common.nodeType === TEXT_NODE ) {
			common = common.parentNode;
		}

		let endNode = split( endContainer, endOffset, common, root ),
			startNode = split( startContainer, startOffset, common, root ),
			frag = doc.createDocumentFragment(),
			next, before, after, beforeText, afterText;

		// End node will be null if at end of child nodes list.
		while ( startNode !== endNode ) {
			next = startNode.nextSibling;
			frag.append( startNode );
			startNode = next;
		}

		startContainer = common;
		startOffset = endNode ?
			indexOf( common.childNodes, endNode ) :
			common.childNodes.length;

		// Merge text nodes if adjacent. IE10 in particular will not focus
		// between two text nodes
		after = common.childNodes[ startOffset ];
		before = after && after.previousSibling;
		if ( before &&
				before.nodeType === TEXT_NODE &&
				after.nodeType === TEXT_NODE ) {
			startContainer = before;
			startOffset = before.length;
			beforeText = before.data;
			afterText = after.data;

			// If we now have two adjacent spaces, the second one needs to become
			// a nbsp, otherwise the browser will swallow it due to HTML whitespace
			// collapsing.
			if ( beforeText.charAt( beforeText.length - 1 ) === ' ' &&
					afterText.charAt( 0 ) === ' ' ) {
				afterText = NBSP + afterText.slice( 1 ); // nbsp
			}
			before.appendData( afterText );
			after.remove();
		}

		range.setStart( startContainer, startOffset );
		range.collapse( true );

		fixCursor( common, root );

		return frag;
	},

	deleteContentsOfRange = ( range, root ) => {
		let startBlock = getStartBlockOfRange( range, root );
		let endBlock = getEndBlockOfRange( range, root );
		let needsMerge = ( startBlock !== endBlock );
		let frag, child;

		// Move boundaries up as much as possible without exiting block,
		// to reduce need to split.
		moveRangeBoundariesDownTree( range );
		moveRangeBoundariesUpTree( range, startBlock, endBlock, root );

		// Remove selected range
		frag = extractContentsOfRange( range, null, root );

		// Move boundaries back down tree as far as possible.
		moveRangeBoundariesDownTree( range );

		// If we split into two different blocks, merge the blocks.
		if ( needsMerge ) {
			// endBlock will have been split, so need to refetch
			endBlock = getEndBlockOfRange( range, root );
			if ( startBlock && endBlock && startBlock !== endBlock ) {
				mergeWithBlock( startBlock, endBlock, range, root );
			}
		}

		// Ensure block has necessary children
		if ( startBlock ) {
			fixCursor( startBlock, root );
		}

		// Ensure root has a block-level element in it.
		child = root.firstChild;
		if ( !child || child.nodeName === 'BR' ) {
			fixCursor( root, root );
			range.selectNodeContents( root.firstChild );
		} else {
			range.collapse( true );
		}
		return frag;
	},

	// Contents of range will be deleted.
	// After method, range will be around inserted content
	insertTreeFragmentIntoRange = ( range, frag, root ) => {
		let firstInFragIsInline = frag.firstChild && isInline( frag.firstChild );
		let node, block, blockContentsAfterSplit, stopPoint, container, offset;
		let replaceBlock, firstBlockInFrag, nodeAfterSplit, nodeBeforeSplit;
		let tempRange;

		// Fixup content: ensure no top-level inline, and add cursor fix elements.
		fixContainer( frag, root );
		node = frag;
		while ( ( node = getNextBlock( node, root ) ) ) {
			fixCursor( node, root );
		}

		// Delete any selected content.
		if ( !range.collapsed ) {
			deleteContentsOfRange( range, root );
		}

		// Move range down into text nodes.
		moveRangeBoundariesDownTree( range );
		range.collapse( false ); // collapse to end

		// Where will we split up to? First blockquote parent, otherwise root.
		stopPoint = getClosest( range.endContainer, root, 'BLOCKQUOTE' ) || root;

		// Merge the contents of the first block in the frag with the focused block.
		// If there are contents in the block after the focus point, collect this
		// up to insert in the last block later. This preserves the style that was
		// present in this bit of the page.
		//
		// If the block being inserted into is empty though, replace it instead of
		// merging if the fragment had block contents.
		// e.g. <blockquote><p>Foo</p></blockquote>
		// This seems a reasonable approximation of user intent.

		block = getStartBlockOfRange( range, root );
		firstBlockInFrag = getNextBlock( frag, frag );
		replaceBlock = !firstInFragIsInline && !!block && isEmptyBlock( block );
		if ( block && firstBlockInFrag && !replaceBlock &&
				// Don't merge table cells or PRE elements into block
				!getClosest( firstBlockInFrag, frag, 'PRE,TABLE' ) ) {
			moveRangeBoundariesUpTree( range, block, block, root );
			range.collapse( true ); // collapse to start
			container = range.endContainer;
			offset = range.endOffset;
			// Remove trailing <br> – we don't want this considered content to be
			// inserted again later
			cleanupBRs( block, root, false );
			if ( isInline( container ) ) {
				// Split up to block parent.
				nodeAfterSplit = split(
					container, offset, getPreviousBlock( container, root ), root );
				container = nodeAfterSplit.parentNode;
				offset = indexOf( container.childNodes, nodeAfterSplit );
			}
			if ( /*isBlock( container ) && */offset !== getLength( container ) ) {
				// Collect any inline contents of the block after the range point
				blockContentsAfterSplit = doc.createDocumentFragment();
				while ( ( node = container.childNodes[ offset ] ) ) {
					blockContentsAfterSplit.append( node );
				}
			}
			// And merge the first block in.
			mergeWithBlock( container, firstBlockInFrag, range, root );

			// And where we will insert
			offset = indexOf( container.parentNode.childNodes, container ) + 1;
			container = container.parentNode;
			range.setEnd( container, offset );
		}

		// Is there still any content in the fragment?
		if ( getLength( frag ) ) {
			if ( replaceBlock ) {
				range.setEndBefore( block );
				range.collapse( false );
				block.remove();
			}
			moveRangeBoundariesUpTree( range, stopPoint, stopPoint, root );
			// Now split after block up to blockquote (if a parent) or root
			nodeAfterSplit = split(
				range.endContainer, range.endOffset, stopPoint, root );
			nodeBeforeSplit = nodeAfterSplit ?
				nodeAfterSplit.previousSibling :
				stopPoint.lastChild;
			stopPoint.insertBefore( frag, nodeAfterSplit );
			if ( nodeAfterSplit ) {
				range.setEndBefore( nodeAfterSplit );
			} else {
				range.setEnd( stopPoint, getLength( stopPoint ) );
			}
			block = getEndBlockOfRange( range, root );

			// Get a reference that won't be invalidated if we merge containers.
			moveRangeBoundariesDownTree( range );
			container = range.endContainer;
			offset = range.endOffset;

			// Merge inserted containers with edges of split
			if ( nodeAfterSplit && isContainer( nodeAfterSplit ) ) {
				mergeContainers( nodeAfterSplit, root );
			}
			nodeAfterSplit = nodeBeforeSplit && nodeBeforeSplit.nextSibling;
			if ( nodeAfterSplit && isContainer( nodeAfterSplit ) ) {
				mergeContainers( nodeAfterSplit, root );
			}
			range.setEnd( container, offset );
		}

		// Insert inline content saved from before.
		if ( blockContentsAfterSplit ) {
			tempRange = range.cloneRange();
			mergeWithBlock( block, blockContentsAfterSplit, tempRange, root );
			range.setEnd( tempRange.endContainer, tempRange.endOffset );
		}
		moveRangeBoundariesDownTree( range );
	},

	isNodeContainedInRange = ( range, node, partial = true ) => {
		let nodeRange = doc.createRange();

		nodeRange.selectNode( node );

		if ( partial ) {
			// Node must not finish before range starts or start after range
			// finishes.
			let nodeEndBeforeStart = ( range.compareBoundaryPoints(
					END_TO_START, nodeRange ) > -1 ),
				nodeStartAfterEnd = ( range.compareBoundaryPoints(
					START_TO_END, nodeRange ) < 1 );
			return ( !nodeEndBeforeStart && !nodeStartAfterEnd );
		}
		else {
			// Node must start after range starts and finish before range
			// finishes
			let nodeStartAfterStart = ( range.compareBoundaryPoints(
					START_TO_START, nodeRange ) < 1 ),
				nodeEndBeforeEnd = ( range.compareBoundaryPoints(
					END_TO_END, nodeRange ) > -1 );
			return ( nodeStartAfterStart && nodeEndBeforeEnd );
		}
	},

	moveRangeBoundariesDownTree = range => {
		let startContainer = range.startContainer,
			startOffset = range.startOffset,
			endContainer = range.endContainer,
			endOffset = range.endOffset,
			maySkipBR = true,
			child;

		while ( startContainer.nodeType !== TEXT_NODE ) {
			child = startContainer.childNodes[ startOffset ];
			if ( !child || isLeaf( child ) ) {
				break;
			}
			startContainer = child;
			startOffset = 0;
		}
		if ( endOffset ) {
			while ( endContainer.nodeType !== TEXT_NODE ) {
				child = endContainer.childNodes[ endOffset - 1 ];
				if ( !child || isLeaf( child ) ) {
					if ( maySkipBR && child && child.nodeName === 'BR' ) {
						--endOffset;
						maySkipBR = false;
						continue;
					}
					break;
				}
				endContainer = child;
				endOffset = getLength( endContainer );
			}
		} else {
			while ( endContainer.nodeType !== TEXT_NODE ) {
				child = endContainer.firstChild;
				if ( !child || isLeaf( child ) ) {
					break;
				}
				endContainer = child;
			}
		}

		// If collapsed, this algorithm finds the nearest text node positions
		// *outside* the range rather than inside, but also it flips which is
		// assigned to which.
		if ( range.collapsed ) {
			range.setStart( endContainer, endOffset );
			range.setEnd( startContainer, startOffset );
		} else {
			range.setStart( startContainer, startOffset );
			range.setEnd( endContainer, endOffset );
		}
	},

	moveRangeBoundariesUpTree = ( range, startMax, endMax, root ) => {
		let startContainer = range.startContainer;
		let startOffset = range.startOffset;
		let endContainer = range.endContainer;
		let endOffset = range.endOffset;
		let maySkipBR = true;
		let parent;

		if ( !startMax ) {
			startMax = range.commonAncestorContainer;
		}
		if ( !endMax ) {
			endMax = startMax;
		}

		while ( !startOffset &&
				startContainer !== startMax &&
				startContainer !== root ) {
			parent = startContainer.parentNode;
			startOffset = indexOf( parent.childNodes, startContainer );
			startContainer = parent;
		}

		while ( true ) {
			if ( endContainer === endMax || endContainer === root ) {
				break;
			}
			if ( maySkipBR &&
					endContainer.nodeType !== TEXT_NODE &&
					endContainer.childNodes[ endOffset ] &&
					endContainer.childNodes[ endOffset ].nodeName === 'BR' ) {
				++endOffset;
				maySkipBR = false;
			}
			if ( endOffset !== getLength( endContainer ) ) {
				break;
			}
			parent = endContainer.parentNode;
			endOffset = indexOf( parent.childNodes, endContainer ) + 1;
			endContainer = parent;
		}

		range.setStart( startContainer, startOffset );
		range.setEnd( endContainer, endOffset );
	},

	moveRangeBoundaryOutOf = ( range, nodeName, root ) => {
		let parent = getClosest( range.endContainer, root, 'A' );
		if ( parent ) {
			let clone = range.cloneRange();
			parent = parent.parentNode;
			moveRangeBoundariesUpTree( clone, parent, parent, root );
			if ( clone.endContainer === parent ) {
				range.setStart( clone.endContainer, clone.endOffset );
				range.setEnd( clone.endContainer, clone.endOffset );
			}
		}
		return range;
	},

	// Returns the first block at least partially contained by the range,
	// or null if no block is contained by the range.
	getStartBlockOfRange = ( range, root ) => {
		let container = range.startContainer,
			block;

		// If inline, get the containing block.
		if ( isInline( container ) ) {
			block = getPreviousBlock( container, root );
		} else if ( container !== root && isBlock( container ) ) {
			block = container;
		} else {
			block = getNodeBefore( container, range.startOffset );
			block = getNextBlock( block, root );
		}
		// Check the block actually intersects the range
		return block && isNodeContainedInRange( range, block ) ? block : null;
	},

	// Returns the last block at least partially contained by the range,
	// or null if no block is contained by the range.
	getEndBlockOfRange = ( range, root ) => {
		let container = range.endContainer,
			block, child;

		// If inline, get the containing block.
		if ( isInline( container ) ) {
			block = getPreviousBlock( container, root );
		} else if ( container !== root && isBlock( container ) ) {
			block = container;
		} else {
			block = getNodeAfter( container, range.endOffset );
			if ( !block || !root.contains( block ) ) {
				block = root;
				while ( child = block.lastChild ) {
					block = child;
				}
			}
			block = getPreviousBlock( block, root );
		}
		// Check the block actually intersects the range
		return block && isNodeContainedInRange( range, block ) ? block : null;
	},

	newContentWalker = root => doc.createTreeWalker( root,
		SHOW_TEXT|SHOW_ELEMENT,
		node => node.nodeType === TEXT_NODE ? notWS.test( node.data ) : node.nodeName === 'IMG'
	),

	rangeDoesStartAtBlockBoundary = ( range, root ) => {
		let startContainer = range.startContainer;
		let startOffset = range.startOffset;
		let nodeAfterCursor;

		// If in the middle or end of a text node, we're not at the boundary.
		if ( startContainer.nodeType === TEXT_NODE ) {
			if ( startOffset ) {
				return false;
			}
			nodeAfterCursor = startContainer;
		} else {
			nodeAfterCursor = getNodeAfter( startContainer, startOffset );
			if ( nodeAfterCursor && !root.contains( nodeAfterCursor ) ) {
				nodeAfterCursor = null;
			}
			// The cursor was right at the end of the document
			if ( !nodeAfterCursor ) {
				nodeAfterCursor = getNodeBefore( startContainer, startOffset );
				if ( nodeAfterCursor.nodeType === TEXT_NODE &&
						nodeAfterCursor.length ) {
					return false;
				}
			}
		}

		// Otherwise, look for any previous content in the same block.
		contentWalker = newContentWalker(getStartBlockOfRange( range, root ));
		contentWalker.currentNode = nodeAfterCursor;

		return !contentWalker.previousNode();
	},

	rangeDoesEndAtBlockBoundary = ( range, root ) => {
		let endContainer = range.endContainer,
			endOffset = range.endOffset,
			length;

		// Otherwise, look for any further content in the same block.
		contentWalker = newContentWalker(getStartBlockOfRange( range, root ));

		// If in a text node with content, and not at the end, we're not
		// at the boundary
		if ( endContainer.nodeType === TEXT_NODE ) {
			length = endContainer.data.length;
			if ( length && endOffset < length ) {
				return false;
			}
			contentWalker.currentNode = endContainer;
		} else {
			contentWalker.currentNode = getNodeBefore( endContainer, endOffset );
		}

		return !contentWalker.nextNode();
	},

	expandRangeToBlockBoundaries = ( range, root ) => {
		let start = getStartBlockOfRange( range, root ),
			end = getEndBlockOfRange( range, root );

		if ( start && end ) {
			range.setStart( start, 0 );
			range.setEnd( end, end.childNodes.length );
//			parent = start.parentNode;
//			range.setStart( parent, indexOf( parent.childNodes, start ) );
//			parent = end.parentNode;
//			range.setEnd( parent, indexOf( parent.childNodes, end ) + 1 );
		}
	};


let contentWalker,
	nodeCategoryCache = new WeakMap();

// Previous node in post-order.
TreeWalker.prototype.previousPONode = function () {
	let current = this.currentNode,
		root = this.root,
		nodeType = this.nodeType,
		filter = this.filter,
		node;
	while ( true ) {
		node = current.lastChild;
		while ( !node && current && current !== root) {
			node = current.previousSibling;
			if ( !node ) { current = current.parentNode; }
		}
		if ( !node ) {
			return null;
		}
		if ( ( typeToBitArray[ node.nodeType ] & nodeType ) && filter( node ) ) {
			this.currentNode = node;
			return node;
		}
		current = node;
	}
};

let onKey = function ( event ) {
	if ( event.defaultPrevented ) {
		return;
	}

	let key = event.key.toLowerCase(),
		modifiers = '',
		range = this.getSelection();

	// We need to apply the backspace/delete handlers regardless of
	// control key modifiers.
	if ( key !== 'backspace' && key !== 'delete' ) {
		if ( event.altKey  ) { modifiers += 'alt-'; }
		if ( event[osKey] ) { modifiers += ctrlKey; }
		if ( event.shiftKey ) { modifiers += 'shift-'; }
	}
	// However, on Windows, shift-delete is apparently "cut" (WTF right?), so
	// we want to let the browser handle shift-delete in this situation.
	if ( isWin && event.shiftKey && key === 'delete' ) {
		modifiers += 'shift-';
	}

	key = modifiers + key;

	if ( this._keyHandlers[ key ] ) {
		this._keyHandlers[ key ]( this, event, range );
	// !event.isComposing stops us from blatting Kana-Kanji conversion in Safari
	} else if ( !range.collapsed && !event.isComposing &&
			!event[osKey] &&
			key.length === 1 ) {
		// Record undo checkpoint.
		this.saveUndoState( range );
		// Delete the selection
		deleteContentsOfRange( range, this._root );
		this._ensureBottomLine();
		this.setSelection( range );
		this._updatePath( range, true );
	}
};

let mapKeyTo = method => ( self, event ) => {
	event.preventDefault();
	self[ method ]();
};

let mapKeyToFormat = ( tag, remove ) => {
	remove = remove || null;
	return ( self, event ) => {
		event.preventDefault();
		let range = self.getSelection();
		if ( self.hasFormat( tag, null, range ) ) {
			self.changeFormat( null, { tag: tag }, range );
		} else {
			self.changeFormat( { tag: tag }, remove, range );
		}
	};
};

// If you delete the content inside a span with a font styling, Webkit will
// replace it with a <font> tag (!). If you delete all the text inside a
// link in Opera, it won't delete the link. Let's make things consistent. If
// you delete all text inside an inline tag, remove the inline tag.
let afterDelete = ( self, range ) => {
	try {
		if ( !range ) { range = self.getSelection(); }
		let node = range.startContainer,
			parent;
		// Climb the tree from the focus point while we are inside an empty
		// inline element
		if ( node.nodeType === TEXT_NODE ) {
			node = node.parentNode;
		}
		parent = node;
		while ( isInline( parent ) &&
				( !parent.textContent || parent.textContent === ZWS ) ) {
			node = parent;
			parent = node.parentNode;
		}
		// If focused in empty inline element
		if ( node !== parent ) {
			// Move focus to just before empty inline(s)
			range.setStart( parent,
				indexOf( parent.childNodes, node ) );
			range.collapse( true );
			// Remove empty inline(s)
			node.remove(  );
			// Fix cursor in block
			if ( !isBlock( parent ) ) {
				parent = getPreviousBlock( parent, self._root );
			}
			fixCursor( parent, self._root );
			// Move cursor into text node
			moveRangeBoundariesDownTree( range );
		}
		// If you delete the last character in the sole <div> in Chrome,
		// it removes the div and replaces it with just a <br> inside the
		// root. Detach the <br>; the _ensureBottomLine call will insert a new
		// block.
		if ( node === self._root &&
				( node = node.firstChild ) && node.nodeName === 'BR' ) {
			node.remove();
		}
		self._ensureBottomLine();
		self.setSelection( range );
		self._updatePath( range, true );
	} catch ( error ) {
		self.didError( error );
	}
};

let detachUneditableNode = ( node, root ) => {
	let parent;
	while (( parent = node.parentNode )) {
		if ( parent === root || parent.isContentEditable ) {
			break;
		}
		node = parent;
	}
	node.remove();
};

let handleEnter = ( self, shiftKey, range ) => {
	let root = self._root;
	let block, parent, node, offset, nodeAfterSplit;

	// Save undo checkpoint and add any links in the preceding section.
	// Remove any zws so we don't think there's content in an empty
	// block.
	self._recordUndoState( range );
	if ( self._config.addLinks ) {
		addLinks( range.startContainer, root, self );
	}
	self._removeZWS();
	self._getRangeAndRemoveBookmark( range );

	// Selected text is overwritten, therefore delete the contents
	// to collapse selection.
	if ( !range.collapsed ) {
		deleteContentsOfRange( range, root );
	}

	block = getStartBlockOfRange( range, root );

	// Inside a PRE, insert literal newline, unless on blank line.
	if ( block && ( parent = getClosest( block, root, 'PRE' ) ) ) {
		moveRangeBoundariesDownTree( range );
		node = range.startContainer;
		offset = range.startOffset;
		if ( node.nodeType !== TEXT_NODE ) {
			node = doc.createTextNode( '' );
			parent.insertBefore( node, parent.firstChild );
		}
		// If blank line: split and insert default block
		if ( !shiftKey &&
				( node.data.charAt( offset - 1 ) === '\n' ||
					rangeDoesStartAtBlockBoundary( range, root ) ) &&
				( node.data.charAt( offset ) === '\n' ||
					rangeDoesEndAtBlockBoundary( range, root ) ) ) {
			node.deleteData( offset && offset - 1, offset ? 2 : 1 );
			nodeAfterSplit =
				split( node, offset && offset - 1, root, root );
			node = nodeAfterSplit.previousSibling;
			if ( !node.textContent ) {
				node.remove();
			}
			node = self.createDefaultBlock();
			nodeAfterSplit.before( node );
			if ( !nodeAfterSplit.textContent ) {
				nodeAfterSplit.remove();
			}
			range.setStart( node, 0 );
		} else {
			node.insertData( offset, '\n' );
			fixCursor( parent, root );
			// Firefox bug: if you set the selection in the text node after
			// the new line, it draws the cursor before the line break still
			// but if you set the selection to the equivalent position
			// in the parent, it works.
			if ( node.length === offset + 1 ) {
				range.setStartAfter( node );
			} else {
				range.setStart( node, offset + 1 );
			}
		}
		range.collapse( true );
		self.setSelection( range );
		self._updatePath( range, true );
		self._docWasChanged();
		return;
	}

	// If this is a malformed bit of document or in a table;
	// just play it safe and insert a <br>.
	if ( !block || shiftKey || /^T[HD]$/.test( block.nodeName ) ) {
		// If inside an <a>, move focus out
		moveRangeBoundaryOutOf( range, 'A', root );
		insertNodeInRange( range, self.createElement( 'BR' ) );
		range.collapse( false );
		self.setSelection( range );
		self._updatePath( range, true );
		return;
	}

	// If in a list, we'll split the LI instead.
	block = getClosest( block, root, 'LI' ) || block;

	if ( isEmptyBlock( block ) && ( parent = getClosest( block, root, 'UL,OL,BLOCKQUOTE' ) ) ) {
		return 'BLOCKQUOTE' === parent.nodeName
			// Break blockquote
			? self.modifyBlocks( (/* frag */) => self.createDefaultBlock( createBookmarkNodes( self ) ), range )
			// Break list
			: self.decreaseListLevel( range );
	}

	// Otherwise, split at cursor point.
	nodeAfterSplit = splitBlock( self, block,
		range.startContainer, range.startOffset );

	// Clean up any empty inlines if we hit enter at the beginning of the block
	removeZWS( block );
	removeEmptyInlines( block );
	fixCursor( block, root );

	// Focus cursor
	// If there's a <b>/<i> etc. at the beginning of the split
	// make sure we focus inside it.
	while ( nodeAfterSplit.nodeType === ELEMENT_NODE ) {
		let child = nodeAfterSplit.firstChild,
			next;

		// Don't continue links over a block break; unlikely to be the
		// desired outcome.
		if ( nodeAfterSplit.nodeName === 'A' &&
				( !nodeAfterSplit.textContent ||
					nodeAfterSplit.textContent === ZWS ) ) {
			child = doc.createTextNode( '' );
			nodeAfterSplit.replaceWith( child );
			nodeAfterSplit = child;
			break;
		}

		while ( child && child.nodeType === TEXT_NODE && !child.data ) {
			next = child.nextSibling;
			if ( !next || next.nodeName === 'BR' ) {
				break;
			}
			child.remove();
			child = next;
		}

		// 'BR's essentially don't count; they're a browser hack.
		// If you try to select the contents of a 'BR', FF will not let
		// you type anything!
		if ( !child || child.nodeName === 'BR' ||
				child.nodeType === TEXT_NODE ) {
			break;
		}
		nodeAfterSplit = child;
	}
	range = self.createRange( nodeAfterSplit, 0 );
	self.setSelection( range );
	self._updatePath( range, true );
};

let keyHandlers = {
	// This song and dance is to force iOS to do enable the shift key
	// automatically on enter. When you do the DOM split manipulation yourself,
	// WebKit doesn't reset the IME state and so presents auto-complete options
	// as though you were continuing to type on the previous line, and doesn't
	// auto-enable the shift key. The old trick of blurring and focussing
	// again no longer works in iOS 13, and I tried various execCommand options
	// but they didn't seem to do anything. The only solution I've found is to
	// let iOS handle the enter key, then after it's done that reset the HTML
	// to what it was before and handle it properly in Squire; the IME state of
	// course doesn't reset so you end up in the correct state!
	enter: isIOS ? ( self, event, range ) => {
		self._saveRangeToBookmark( range );
		let html = self._getHTML();
		let restoreAndDoEnter = () => {
			self.removeEventListener( 'keyup', restoreAndDoEnter );
			self._setHTML( html );
			range = self._getRangeAndRemoveBookmark();
			// Ignore the shift key on iOS, as this is for auto-capitalisation.
			handleEnter( self, false, range );
		};
		self.addEventListener( 'keyup', restoreAndDoEnter );
	} : ( self, event, range ) => {
		event.preventDefault();
		handleEnter( self, event.shiftKey, range );
	},

	'shift-enter': ( self, event, range ) => self._keyHandlers.enter( self, event, range ),

	backspace: ( self, event, range ) => {
		let root = self._root;
		self._removeZWS();
		// Record undo checkpoint.
		self.saveUndoState( range );
		// If not collapsed, delete contents
		if ( !range.collapsed ) {
			event.preventDefault();
			deleteContentsOfRange( range, root );
			afterDelete( self, range );
		}
		// If at beginning of block, merge with previous
		else if ( rangeDoesStartAtBlockBoundary( range, root ) ) {
			event.preventDefault();
			let current = getStartBlockOfRange( range, root );
			let previous;
			if ( !current ) {
				return;
			}
			// In case inline data has somehow got between blocks.
			fixContainer( current.parentNode, root );
			// Now get previous block
			previous = getPreviousBlock( current, root );
			// Must not be at the very beginning of the text area.
			if ( previous ) {
				// If not editable, just delete whole block.
				if ( !previous.isContentEditable ) {
					detachUneditableNode( previous, root );
					return;
				}
				// Otherwise merge.
				mergeWithBlock( previous, current, range, root );
				// If deleted line between containers, merge newly adjacent
				// containers.
				current = previous.parentNode;
				while ( current !== root && !current.nextSibling ) {
					current = current.parentNode;
				}
				if ( current !== root && ( current = current.nextSibling ) ) {
					mergeContainers( current, root );
				}
				self.setSelection( range );
			}
			// If at very beginning of text area, allow backspace
			// to break lists/blockquote.
			else if ( current ) {
				let parent = getClosest( current, root, 'UL,OL,BLOCKQUOTE' );
				if (parent) {
					return ( 'BLOCKQUOTE' === parent.nodeName )
						// Break blockquote
						? self.modifyBlocks( decreaseBlockQuoteLevel, range )
						// Break list
						: self.decreaseListLevel( range );
				}
				self.setSelection( range );
				self._updatePath( range, true );
			}
		}
		// Otherwise, leave to browser but check afterwards whether it has
		// left behind an empty inline tag.
		else {
			self.setSelection( range );
			setTimeout( () => afterDelete( self ), 0 );
		}
	},
	'delete': ( self, event, range ) => {
		let root = self._root;
		let current, next, originalRange,
			cursorContainer, cursorOffset, nodeAfterCursor;
		self._removeZWS();
		// Record undo checkpoint.
		self.saveUndoState( range );
		// If not collapsed, delete contents
		if ( !range.collapsed ) {
			event.preventDefault();
			deleteContentsOfRange( range, root );
			afterDelete( self, range );
		}
		// If at end of block, merge next into this block
		else if ( rangeDoesEndAtBlockBoundary( range, root ) ) {
			event.preventDefault();
			current = getStartBlockOfRange( range, root );
			if ( !current ) {
				return;
			}
			// In case inline data has somehow got between blocks.
			fixContainer( current.parentNode, root );
			// Now get next block
			next = getNextBlock( current, root );
			// Must not be at the very end of the text area.
			if ( next ) {
				// If not editable, just delete whole block.
				if ( !next.isContentEditable ) {
					detachUneditableNode( next, root );
					return;
				}
				// Otherwise merge.
				mergeWithBlock( current, next, range, root );
				// If deleted line between containers, merge newly adjacent
				// containers.
				next = current.parentNode;
				while ( next !== root && !next.nextSibling ) {
					next = next.parentNode;
				}
				if ( next !== root && ( next = next.nextSibling ) ) {
					mergeContainers( next, root );
				}
				self.setSelection( range );
				self._updatePath( range, true );
			}
		}
		// Otherwise, leave to browser but check afterwards whether it has
		// left behind an empty inline tag.
		else {
			// But first check if the cursor is just before an IMG tag. If so,
			// delete it ourselves, because the browser won't if it is not
			// inline.
			originalRange = range.cloneRange();
			moveRangeBoundariesUpTree( range, root, root, root );
			cursorContainer = range.endContainer;
			cursorOffset = range.endOffset;
			if ( cursorContainer.nodeType === ELEMENT_NODE ) {
				nodeAfterCursor = cursorContainer.childNodes[ cursorOffset ];
				if ( nodeAfterCursor && nodeAfterCursor.nodeName === 'IMG' ) {
					event.preventDefault();
					nodeAfterCursor.remove();
					moveRangeBoundariesDownTree( range );
					afterDelete( self, range );
					return;
				}
			}
			self.setSelection( originalRange );
			setTimeout( () => afterDelete( self ), 0 );
		}
	},
	tab: ( self, event, range ) => {
		let root = self._root;
		let node, parent;
		self._removeZWS();
		// If no selection and at start of block
		if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
			node = getStartBlockOfRange( range, root );
			// Iterate through the block's parents
			while ( ( parent = node.parentNode ) ) {
				// If we find a UL or OL (so are in a list, node must be an LI)
				if ( parent.nodeName === 'UL' || parent.nodeName === 'OL' ) {
					// Then increase the list level
					event.preventDefault();
					self.increaseListLevel( range );
					break;
				}
				node = parent;
			}
		}
	},
	'shift-tab': ( self, event, range ) => {
		let root = self._root;
		let node;
		self._removeZWS();
		// If no selection and at start of block
		if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
			// Break list
			node = range.startContainer;
			if ( getClosest( node, root, 'UL,OL' ) ) {
				event.preventDefault();
				self.decreaseListLevel( range );
			}
		}
	},
	space: ( self, _, range ) => {
		let node;
		let root = self._root;
		self._recordUndoState( range );
		if ( self._config.addLinks ) {
			addLinks( range.startContainer, root, self );
		}
		self._getRangeAndRemoveBookmark( range );

		// If the cursor is at the end of a link (<a>foo|</a>) then move it
		// outside of the link (<a>foo</a>|) so that the space is not part of
		// the link text.
		node = range.endContainer;
		if ( range.collapsed && range.endOffset === getLength( node ) ) {
			do {
				if ( node.nodeName === 'A' ) {
					range.setStartAfter( node );
					break;
				}
			} while ( !node.nextSibling &&
				( node = node.parentNode ) && node !== root );
		}
		// Delete the selection if not collapsed
		if ( !range.collapsed ) {
			deleteContentsOfRange( range, root );
			self._ensureBottomLine();
			self.setSelection( range );
			self._updatePath( range, true );
		}

		self.setSelection( range );
	},
	arrowleft: self => self._removeZWS(),
	arrowright: self => self._removeZWS()
};

// System standard for page up/down on Mac is to just scroll, not move the
// cursor. On Linux/Windows, it should move the cursor, but some browsers don't
// implement this natively. Override to support it.
function _moveCursorTo( self, toStart ) {
	let root = self._root,
		range = self.createRange( root, toStart ? 0 : root.childNodes.length );
	moveRangeBoundariesDownTree( range );
	self.setSelection( range );
	return self;
}
if ( !isMac ) {
	keyHandlers.pageup = self => _moveCursorTo( self, true );
	keyHandlers.pagedown = self => _moveCursorTo( self, false );
}

const changeIndentationLevel = direction => ( self, event ) => {
	event.preventDefault();
	self.changeIndentationLevel(direction);
};

const toggleList = ( type, methodIfNotInList ) => ( self, event ) => {
	event.preventDefault();
	let parent = self.getSelectionClosest('UL,OL');
	if (parent && type == parent.nodeName) {
		self.removeList();
	} else {
		self[ methodIfNotInList ]();
	}
};

keyHandlers[ ctrlKey + 'b' ] = mapKeyToFormat( 'B' );
keyHandlers[ ctrlKey + 'i' ] = mapKeyToFormat( 'I' );
keyHandlers[ ctrlKey + 'u' ] = mapKeyToFormat( 'U' );
keyHandlers[ ctrlKey + 'shift-7' ] = mapKeyToFormat( 'S' );
keyHandlers[ ctrlKey + 'shift-5' ] = mapKeyToFormat( 'SUB', { tag: 'SUP' } );
keyHandlers[ ctrlKey + 'shift-6' ] = mapKeyToFormat( 'SUP', { tag: 'SUB' } );
keyHandlers[ ctrlKey + 'shift-8' ] = toggleList( 'UL', 'makeUnorderedList' );
keyHandlers[ ctrlKey + 'shift-9' ] = toggleList( 'OL', 'makeOrderedList' );
keyHandlers[ ctrlKey + '[' ] = changeIndentationLevel( 'decrease' );
keyHandlers[ ctrlKey + ']' ] = changeIndentationLevel( 'increase' );
keyHandlers[ ctrlKey + 'd' ] = mapKeyTo( 'toggleCode' );
keyHandlers[ ctrlKey + 'y' ] = mapKeyTo( 'redo' );
keyHandlers[ 'redo' ] = mapKeyTo( 'redo' );
keyHandlers[ ctrlKey + 'z' ] = mapKeyTo( 'undo' );
keyHandlers[ 'undo' ] = mapKeyTo( 'undo' );
keyHandlers[ ctrlKey + 'shift-z' ] = mapKeyTo( 'redo' );

let fontSizes = {
	1: 10,
	2: 13,
	3: 16,
	4: 18,
	5: 24,
	6: 32,
	7: 48
};

let styleToSemantic = {
	fontWeight: {
		regexp: /^bold|^700/i,
		replace: doc => createElement( doc, 'B' )
	},
	fontStyle: {
		regexp: /^italic/i,
		replace: doc => createElement( doc, 'I' )
	},
	fontFamily: {
		regexp: notWS,
		replace: ( doc, classNames, family ) => createElement( doc, 'SPAN', {
			'class': classNames.fontFamily,
			style: 'font-family:' + family
		})
	},
	fontSize: {
		regexp: notWS,
		replace: ( doc, classNames, size ) => createElement( doc, 'SPAN', {
			'class': classNames.fontSize,
			style: 'font-size:' + size
		})
	},
	textDecoration: {
		regexp: /^underline/i,
		replace: doc => createElement( doc, 'U' )
	}
/*
	textDecoration: {
		regexp: /^line-through/i,
		replace: doc => createElement( doc, 'S' )
	}
*/
};

let replaceWithTag = tag => node => {
	let el = createElement( doc, tag );
	Array.prototype.forEach.call( node.attributes, attr => el.setAttribute( attr.name, attr.value ) );
	node.replaceWith( el );
	el.append( empty( node ) );
	return el;
};

let replaceStyles = ( node, parent, config ) => {
	let style = node.style;
	let attr, converter, css, newTreeBottom, newTreeTop, el;

	for ( attr in styleToSemantic ) {
		converter = styleToSemantic[ attr ];
		css = style[ attr ];
		if ( css && converter.regexp.test( css ) ) {
			el = converter.replace( doc, config.classNames, css );
			if ( el.nodeName === node.nodeName &&
					el.className === node.className ) {
				continue;
			}
			if ( !newTreeTop ) {
				newTreeTop = el;
			}
			if ( newTreeBottom ) {
				newTreeBottom.append( el );
			}
			newTreeBottom = el;
			node.style[ attr ] = '';
		}
	}

	if ( newTreeTop ) {
		newTreeBottom.append( empty( node ) );
		node.append( newTreeTop );
	}

	return newTreeBottom || node;
};

let stylesRewriters = {
	SPAN: replaceStyles,
	STRONG: replaceWithTag( 'B' ),
	EM: replaceWithTag( 'I' ),
	INS: replaceWithTag( 'U' ),
	STRIKE: replaceWithTag( 'S' ),
	FONT: ( node, parent, config ) => {
		let face = node.face;
		let size = node.size;
		let colour = node.color;
		let classNames = config.classNames;
		let fontSpan, sizeSpan, colourSpan;
		let newTreeBottom, newTreeTop;
		if ( face ) {
			fontSpan = createElement( doc, 'SPAN', {
				'class': classNames.fontFamily,
				style: 'font-family:' + face
			});
			newTreeTop = fontSpan;
			newTreeBottom = fontSpan;
		}
		if ( size ) {
			sizeSpan = createElement( doc, 'SPAN', {
				'class': classNames.fontSize,
				style: 'font-size:' + fontSizes[ size ] + 'px'
			});
			if ( !newTreeTop ) {
				newTreeTop = sizeSpan;
			}
			if ( newTreeBottom ) {
				newTreeBottom.append( sizeSpan );
			}
			newTreeBottom = sizeSpan;
		}
		if ( colour && /^#?([\dA-F]{3}){1,2}$/i.test( colour ) ) {
			if ( colour.charAt( 0 ) !== '#' ) {
				colour = '#' + colour;
			}
			colourSpan = createElement( doc, 'SPAN', {
				'class': classNames.colour,
				style: 'color:' + colour
			});
			if ( !newTreeTop ) {
				newTreeTop = colourSpan;
			}
			if ( newTreeBottom ) {
				newTreeBottom.append( colourSpan );
			}
			newTreeBottom = colourSpan;
		}
		if ( !newTreeTop ) {
			newTreeTop = newTreeBottom = createElement( doc, 'SPAN' );
		}
		node.replaceWith( newTreeTop );
		newTreeBottom.append( empty( node ) );
		return newTreeBottom;
	},
//	KBD:
//	VAR:
//	CODE:
//	SAMP:
	TT: ( node, parent, config ) => {
		let el = createElement( doc, 'SPAN', {
			'class': config.classNames.fontFamily,
			style: 'font-family:menlo,consolas,"courier new",monospace'
		});
		node.replaceWith( el );
		el.append( empty( node ) );
		return el;
	}
};

let allowedBlock = /^(?:A(?:DDRESS|RTICLE|SIDE|UDIO)|BLOCKQUOTE|CAPTION|D(?:[DLT]|IV)|F(?:IGURE|IGCAPTION|OOTER)|H[1-6]|HEADER|L(?:ABEL|EGEND|I)|O(?:L|UTPUT)|P(?:RE)?|SECTION|T(?:ABLE|BODY|D|FOOT|H|HEAD|R)|COL(?:GROUP)?|UL)$/;

let blacklist = /^(?:HEAD|META|STYLE)/;

/*
	Two purposes:

	1. Remove nodes we don't want, such as weird <o:p> tags, comment nodes
	   and whitespace nodes.
	2. Convert inline tags into our preferred format.
*/
let cleanTree = ( node, config, preserveWS ) => {
	let children = node.childNodes,
		nonInlineParent, i, l, child, nodeName, nodeType, rewriter, childLength,
		startsWithWS, endsWithWS, data, sibling;

	nonInlineParent = node;
	while ( isInline( nonInlineParent ) ) {
		nonInlineParent = nonInlineParent.parentNode;
	}
	let walker = doc.createTreeWalker( nonInlineParent, SHOW_TEXT|SHOW_ELEMENT );

	for ( i = 0, l = children.length; i < l; ++i ) {
		child = children[i];
		nodeName = child.nodeName;
		nodeType = child.nodeType;
		if ( nodeType === ELEMENT_NODE ) {
			rewriter = stylesRewriters[ nodeName ];
			childLength = child.childNodes.length;
			if ( rewriter ) {
				child = rewriter( child, node, config );
			} else if ( blacklist.test( nodeName ) ) {
				child.remove(  );
				--i;
				--l;
				continue;
			} else if ( !allowedBlock.test( nodeName ) && !isInline( child ) ) {
				--i;
				l += childLength - 1;
				child.replaceWith( empty( child ) );
				continue;
			}
			if ( childLength ) {
				cleanTree( child, config,
					preserveWS || ( nodeName === 'PRE' ) );
			}
		} else {
			if ( nodeType === TEXT_NODE ) {
				data = child.data;
				startsWithWS = !notWS.test( data.charAt( 0 ) );
				endsWithWS = !notWS.test( data.charAt( data.length - 1 ) );
				if ( preserveWS || ( !startsWithWS && !endsWithWS ) ) {
					continue;
				}
				// Iterate through the nodes; if we hit some other content
				// before the start of a new block we don't trim
				if ( startsWithWS ) {
					walker.currentNode = child;
					while ( sibling = walker.previousPONode() ) {
						nodeName = sibling.nodeName;
						if ( nodeName === 'IMG' ||
								( nodeName === '#text' &&
									notWS.test( sibling.data ) ) ) {
							break;
						}
						if ( !isInline( sibling ) ) {
							sibling = null;
							break;
						}
					}
					data = data.replace( /^[ \t\r\n]+/g, sibling ? ' ' : '' );
				}
				if ( endsWithWS ) {
					walker.currentNode = child;
					while ( sibling = walker.nextNode() ) {
						if ( nodeName === 'IMG' ||
								( nodeName === '#text' &&
									notWS.test( sibling.data ) ) ) {
							break;
						}
						if ( !isInline( sibling ) ) {
							sibling = null;
							break;
						}
					}
					data = data.replace( /[ \t\r\n]+$/g, sibling ? ' ' : '' );
				}
				if ( data ) {
					child.data = data;
					continue;
				}
			}
			child.remove(  );
			--i;
			--l;
		}
	}
	return node;
};

// ---

let removeEmptyInlines = node => {
	let children = node.childNodes,
		l = children.length,
		child;
	while ( l-- ) {
		child = children[l];
		if ( child.nodeType === ELEMENT_NODE && !isLeaf( child ) ) {
			removeEmptyInlines( child );
			if ( isInline( child ) && !child.firstChild ) {
				child.remove(  );
			}
		} else if ( child.nodeType === TEXT_NODE && !child.data ) {
			child.remove(  );
		}
	}
};

// ---

let notWSTextNode = node => node.nodeType === ELEMENT_NODE ? node.nodeName === 'BR' : notWS.test( node.data );
let isLineBreak = ( br, isLBIfEmptyBlock ) => {
	let block = br.parentNode;
	let walker;
	while ( isInline( block ) ) {
		block = block.parentNode;
	}
	walker = doc.createTreeWalker( block, SHOW_ELEMENT|SHOW_TEXT, notWSTextNode );
	walker.currentNode = br;
	return !!walker.nextNode() ||
		( isLBIfEmptyBlock && !walker.previousNode() );
};

// <br> elements are treated specially, and differently depending on the
// browser, when in rich text editor mode. When adding HTML from external
// sources, we must remove them, replacing the ones that actually affect
// line breaks by wrapping the inline text in a <div>. Browsers that want <br>
// elements at the end of each block will then have them added back in a later
// fixCursor method call.
let cleanupBRs = ( node, root, keepForBlankLine ) => {
	let brs = node.querySelectorAll( 'BR' );
	let brBreaksLine = [];
	let l = brs.length;
	let i, br, parent;

	// Must calculate whether the <br> breaks a line first, because if we
	// have two <br>s next to each other, after the first one is converted
	// to a block split, the second will be at the end of a block and
	// therefore seem to not be a line break. But in its original context it
	// was, so we should also convert it to a block split.
	for ( i = 0; i < l; ++i ) {
		brBreaksLine[i] = isLineBreak( brs[i], keepForBlankLine );
	}
	while ( l-- ) {
		br = brs[l];
		// Cleanup may have removed it
		parent = br.parentNode;
		if ( !parent ) { continue; }
		// If it doesn't break a line, just remove it; it's not doing
		// anything useful. We'll add it back later if required by the
		// browser. If it breaks a line, wrap the content in div tags
		// and replace the brs.
		if ( !brBreaksLine[l] ) {
			br.remove();
		} else if ( !isInline( parent ) ) {
			fixContainer( parent, root );
		}
	}
};

// The (non-standard but supported enough) innerText property is based on the
// render tree in Firefox and possibly other browsers, so we must insert the
// DOM node into the document to ensure the text part is correct.
let setClipboardData =
		( event, contents, root, willCutCopy, toPlainText, plainTextOnly ) => {
	let clipboardData = event.clipboardData;
	let body = doc.body;
	let node = createElement( doc, 'div' );
	let html, text;

	node.append( contents );

	html = node.innerHTML;
	if ( willCutCopy ) {
		html = willCutCopy( html );
	}

	if ( toPlainText ) {
		text = toPlainText( html );
	} else {
		// Firefox will add an extra new line for BRs at the end of block when
		// calculating innerText, even though they don't actually affect
		// display, so we need to remove them first.
		cleanupBRs( node, root, true );
		node.setAttribute( 'style',
			'position:fixed;overflow:hidden;bottom:100%;right:100%;' );
		body.append( node );
		text = node.innerText || node.textContent;
		text = text.replace( NBSP, ' ' ); // Replace nbsp with regular space
		node.remove(  );
	}
	// Firefox (and others?) returns unix line endings (\n) even on Windows.
	// If on Windows, normalise to \r\n, since Notepad and some other crappy
	// apps do not understand just \n.
	if ( isWin ) {
		text = text.replace( /\r?\n/g, '\r\n' );
	}

	if ( !plainTextOnly && text !== html ) {
		clipboardData.setData( 'text/html', html );
	}
	clipboardData.setData( 'text/plain', text );
	event.preventDefault();
};

let onCut = function ( event ) {
	let range = this.getSelection();
	let root = this._root;
	let self = this;
	let startBlock, endBlock, copyRoot, contents, parent, newContents;

	// Nothing to do
	if ( range.collapsed ) {
		event.preventDefault();
		return;
	}

	// Save undo checkpoint
	this.saveUndoState( range );

	// Edge only seems to support setting plain text as of 2016-03-11.
	if ( !isEdge && event.clipboardData ) {
		// Clipboard content should include all parents within block, or all
		// parents up to root if selection across blocks
		startBlock = getStartBlockOfRange( range, root );
		endBlock = getEndBlockOfRange( range, root );
		copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root;
		// Extract the contents
		contents = deleteContentsOfRange( range, root );
		// Add any other parents not in extracted content, up to copy root
		parent = range.commonAncestorContainer;
		if ( parent.nodeType === TEXT_NODE ) {
			parent = parent.parentNode;
		}
		while ( parent && parent !== copyRoot ) {
			newContents = parent.cloneNode( false );
			newContents.append( contents );
			contents = newContents;
			parent = parent.parentNode;
		}
		// Set clipboard data
		setClipboardData(
			event, contents, root, this._config.willCutCopy, null, false );
	} else {
		setTimeout( () => {
			try {
				// If all content removed, ensure div at start of root.
				self._ensureBottomLine();
			} catch ( error ) {
				self.didError( error );
			}
		}, 0 );
	}

	this.setSelection( range );
};

let onCopy = function ( event ) {
	// Edge only seems to support setting plain text as of 2016-03-11.
	if ( !isEdge && event.clipboardData ) {
		let range = this.getSelection(), root = this._root,
			// Clipboard content should include all parents within block, or all
			// parents up to root if selection across blocks
			startBlock = getStartBlockOfRange( range, root ),
			endBlock = getEndBlockOfRange( range, root ),
			copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root,
			contents, parent, newContents;
		// Clone range to mutate, then move up as high as possible without
		// passing the copy root node.
		range = range.cloneRange();
		moveRangeBoundariesDownTree( range );
		moveRangeBoundariesUpTree( range, copyRoot, copyRoot, root );
		// Extract the contents
		contents = range.cloneContents();
		// Add any other parents not in extracted content, up to copy root
		parent = range.commonAncestorContainer;
		if ( parent.nodeType === TEXT_NODE ) {
			parent = parent.parentNode;
		}
		while ( parent && parent !== copyRoot ) {
			newContents = parent.cloneNode( false );
			newContents.append( contents );
			contents = newContents;
			parent = parent.parentNode;
		}
		// Set clipboard data
		setClipboardData( event, contents, root, this._config.willCutCopy, null, false );
	}
};

// Need to monitor for shift key like this, as event.shiftKey is not available
// in paste event.
function monitorShiftKey ( event ) {
	this.isShiftDown = event.shiftKey;
}

let onPaste = function ( event ) {
	let clipboardData = event.clipboardData;
	let items = clipboardData && clipboardData.items;
	let choosePlain = this.isShiftDown;
	let fireDrop = false;
	let hasRTF = false;
	let hasImage = false;
	let plainItem = null;
	let htmlItem = null;
	let self = this;
	let l, item, type, types, data;

	// Current HTML5 Clipboard interface
	// ---------------------------------
	// https://html.spec.whatwg.org/multipage/interaction.html
	if ( items ) {
		l = items.length;
		while ( l-- ) {
			item = items[l];
			type = item.type;
			if ( type === 'text/html' ) {
				htmlItem = item;
			// iOS copy URL gives you type text/uri-list which is just a list
			// of 1 or more URLs separated by new lines. Can just treat as
			// plain text.
			} else if ( type === 'text/plain' || type === 'text/uri-list' ) {
				plainItem = item;
			} else if ( type === 'text/rtf' ) {
				hasRTF = true;
			} else if ( /^image\/.*/.test( type ) ) {
				hasImage = true;
			}
		}

		// Treat image paste as a drop of an image file. When you copy
		// an image in Chrome/Firefox (at least), it copies the image data
		// but also an HTML version (referencing the original URL of the image)
		// and a plain text version.
		//
		// However, when you copy in Excel, you get html, rtf, text, image;
		// in this instance you want the html version! So let's try using
		// the presence of text/rtf as an indicator to choose the html version
		// over the image.
		if ( hasImage && !( hasRTF && htmlItem ) ) {
			event.preventDefault();
			this.fireEvent( 'dragover', {
				dataTransfer: clipboardData,
				/*jshint loopfunc: true */
				preventDefault: () => fireDrop = true
				/*jshint loopfunc: false */
			});
			if ( fireDrop ) {
				this.fireEvent( 'drop', {
					dataTransfer: clipboardData
				});
			}
			return;
		}

		// Edge only provides access to plain text as of 2016-03-11 and gives no
		// indication there should be an HTML part. However, it does support
		// access to image data, so we check for that first. Otherwise though,
		// fall through to fallback clipboard handling methods
		if ( !isEdge ) {
			event.preventDefault();
			if ( htmlItem && ( !choosePlain || !plainItem ) ) {
				htmlItem.getAsString( html => self.insertHTML( html, true ) );
			} else if ( plainItem ) {
				plainItem.getAsString( text => self.insertPlainText( text, true ) );
			}
			return;
		}
	}

	// Safari (and indeed many other OS X apps) copies stuff as text/rtf
	// rather than text/html; even from a webpage in Safari. The only way
	// to get an HTML version is to fallback to letting the browser insert
	// the content. Same for getting image data. *Sigh*.
	types = clipboardData && clipboardData.types;
	if ( !isEdge && types && (
			indexOf( types, 'text/html' ) > -1 || (
				!isGecko &&
				indexOf( types, 'text/plain' ) > -1 &&
				indexOf( types, 'text/rtf' ) < 0 )
			)) {
		event.preventDefault();
		// Abiword on Linux copies a plain text and html version, but the HTML
		// version is the empty string! So always try to get HTML, but if none,
		// insert plain text instead. On iOS, Facebook (and possibly other
		// apps?) copy links as type text/uri-list, but also insert a **blank**
		// text/plain item onto the clipboard. Why? Who knows.
		if ( !choosePlain && ( data = clipboardData.getData( 'text/html' ) ) ) {
			this.insertHTML( data, true );
		} else if (
				( data = clipboardData.getData( 'text/plain' ) ) ||
				( data = clipboardData.getData( 'text/uri-list' ) ) ) {
			this.insertPlainText( data, true );
		}
		return;
	}
};

// On Windows you can drag an drop text. We can't handle this ourselves, because
// as far as I can see, there's no way to get the drop insertion point. So just
// save an undo state and hope for the best.
let onDrop = function ( event ) {
	let types = event.dataTransfer.types;
	let l = types.length;
	let hasPlain = false;
	let hasHTML = false;
	while ( l-- ) {
		switch ( types[l] ) {
		case 'text/plain':
			hasPlain = true;
			break;
		case 'text/html':
			hasHTML = true;
			break;
		default:
			return;
		}
	}
	if ( hasHTML || hasPlain ) {
		this.saveUndoState();
	}
};

function mergeObjects ( base, extras, mayOverride ) {
	let prop, value;
	if ( !base ) {
		base = {};
	}
	if ( extras ) {
		for ( prop in extras ) {
			if ( mayOverride || !( prop in base ) ) {
				value = extras[ prop ];
				base[ prop ] = ( value && value.constructor === Object ) ?
					mergeObjects( base[ prop ], value, mayOverride ) :
					value;
			}
		}
	}
	return base;
}

function Squire ( root, config ) {
	if ( root.nodeType === DOCUMENT_NODE ) {
		root = root.body;
	}
	let mutation;

	this._root = root;

	this._events = {};

	this._isFocused = false;
	this._lastRange = null;

	this._hasZWS = false;

	this._lastAnchorNode = null;
	this._lastFocusNode = null;
	this._path = '';
	this._willUpdatePath = false;

	const selectionchange = () => {
		if (root.contains(doc.activeElement)) {
			let self = this;
			if ( self._isFocused && !self._willUpdatePath ) {
				self._willUpdatePath = true;
				setTimeout( function () {
					self._willUpdatePath = false;
					self._updatePath( self.getSelection() );
				}, 0 );
			}
		} else {
			this.removeEventListener('selectionchange', selectionchange);
		}
	};
	this.addEventListener('selectstart', () => this.addEventListener('selectionchange', selectionchange));

	this._undoIndex = -1;
	this._undoStack = [];
	this._undoStackLength = 0;
	this._isInUndoState = false;
	this._ignoreChange = false;
	this._ignoreAllChanges = false;

	mutation = new MutationObserver( ()=>this._docWasChanged() );
	mutation.observe( root, {
		childList: true,
		attributes: true,
		characterData: true,
		subtree: true
	});
	this._mutation = mutation;

	// On blur, restore focus except if the user taps or clicks to focus a
	// specific point. Can't actually use click event because focus happens
	// before click, so use mousedown/touchstart
	this._restoreSelection = false;
	// https://caniuse.com/mdn-api_document_pointerup_event
	this.addEventListener( 'blur', () => this._restoreSelection = true )
		.addEventListener( 'pointerdown mousedown touchstart', () => this._restoreSelection = false )
		.addEventListener( 'focus', () => this._restoreSelection && this.setSelection( this._lastRange ) )
		.addEventListener( 'cut', onCut )
		.addEventListener( 'copy', onCopy )
		.addEventListener( 'keydown keyup', monitorShiftKey )
		.addEventListener( 'paste', onPaste )
		.addEventListener( 'drop', onDrop )
		.addEventListener( 'keydown', onKey )
		.addEventListener( 'pointerup keyup mouseup touchend', ()=>this.getSelection() );

	// Add key handlers
	this._keyHandlers = Object.create( keyHandlers );

	// Override default properties
	this.setConfig( config );

	root.setAttribute( 'contenteditable', 'true' );
	// Grammarly breaks the editor, *sigh*
	root.setAttribute( 'data-gramm', 'false' );

	// Remove Firefox's built-in controls
	try {
		doc.execCommand( 'enableObjectResizing', false, 'false' );
		doc.execCommand( 'enableInlineTableEditing', false, 'false' );
	} catch ( error ) {}

	root.__squire__ = this;

	// Need to register instance before calling setHTML, so that the fixCursor
	// function can lookup any default block tag options set.
	this.setHTML( '' );
}

let proto = Squire.prototype;

let sanitizeToDOMFragment = ( html ) => {
	let frag = html ? win.DOMPurify.sanitize( html, {
		ALLOW_UNKNOWN_PROTOCOLS: true,
		WHOLE_DOCUMENT: false,
		RETURN_DOM: true,
		RETURN_DOM_FRAGMENT: true
	}) : null;
	return frag ? doc.importNode( frag, true ) : doc.createDocumentFragment();
};

proto.setConfig = function ( config ) {
	config = mergeObjects({
		blockTag: 'DIV',
		blockAttributes: null,
		tagAttributes: {
			blockquote: null,
			ul: null,
			ol: null,
			li: null,
			a: null
		},
		classNames: {
			colour: 'colour',
			fontFamily: 'font',
			fontSize: 'size',
			highlight: 'highlight'
		},
		leafNodeNames: leafNodeNames,
		undo: {
			documentSizeThreshold: -1, // -1 means no threshold
			undoLimit: -1 // -1 means no limit
		},
		isInsertedHTMLSanitized: true,
		isSetHTMLSanitized: true,
		sanitizeToDOMFragment: win.DOMPurify && win.DOMPurify.isSupported ? sanitizeToDOMFragment : null,
		willCutCopy: null,
		addLinks: true
	}, config, true );

	// Users may specify block tag in lower case
	config.blockTag = config.blockTag.toUpperCase();

	this._config = config;

	return this;
};

proto.createElement = function ( tag, props, children ) {
	return createElement( doc, tag, props, children );
};

proto.createDefaultBlock = function ( children ) {
	let config = this._config;
	return fixCursor(
		this.createElement( config.blockTag, config.blockAttributes, children ),
		this._root
	);
};

proto.didError = error => console.error( error );

proto.getRoot = function () {
	return this._root;
};

proto.modifyDocument = function ( modificationCallback ) {
	let mutation = this._mutation;
	if ( mutation ) {
		if ( mutation.takeRecords().length ) {
			this._docWasChanged();
		}
		mutation.disconnect();
	}

	this._ignoreAllChanges = true;
	modificationCallback();
	this._ignoreAllChanges = false;

	if ( mutation ) {
		mutation.observe( this._root, {
			childList: true,
			attributes: true,
			characterData: true,
			subtree: true
		});
		this._ignoreChange = false;
	}
};

// --- Events ---

// Subscribing to these events won't automatically add a listener to the
// document node, since these events are fired in a custom manner by the
// editor code.
let customEvents = {
	pathChange: 1, select: 1, input: 1, undoStateChange: 1
};

proto.fireEvent = function ( type, event ) {
	let handlers = this._events[ type ];
	let isFocused, l, obj;
	// UI code, especially modal views, may be monitoring for focus events and
	// immediately removing focus. In certain conditions, this can cause the
	// focus event to fire after the blur event, which can cause an infinite
	// loop. So we detect whether we're actually focused/blurred before firing.
	if ( /^(?:focus|blur)/.test( type ) ) {
		isFocused = this._root === doc.activeElement;
		if ( type === 'focus' ) {
			if ( !isFocused || this._isFocused ) {
				return this;
			}
			this._isFocused = true;
		} else {
			if ( isFocused || !this._isFocused ) {
				return this;
			}
			this._isFocused = false;
		}
	}
	if ( handlers ) {
		if ( !event ) {
			event = {};
		}
		if ( event.type !== type ) {
			event.type = type;
		}
		// Clone handlers array, so any handlers added/removed do not affect it.
		handlers = handlers.slice();
		l = handlers.length;
		while ( l-- ) {
			obj = handlers[l];
			try {
				if ( obj.handleEvent ) {
					obj.handleEvent( event );
				} else {
					obj.call( this, event );
				}
			} catch ( error ) {
				error.details = 'Squire: fireEvent error. Event type: ' + type;
				this.didError( error );
			}
		}
	}
	return this;
};

proto.destroy = function () {
	let events = this._events;
	let type;

	for ( type in events ) {
		this.removeEventListener( type );
	}
	if ( this._mutation ) {
		this._mutation.disconnect();
	}
	delete this._root.__squire__;

	// Destroy undo stack
	this._undoIndex = -1;
	this._undoStack = [];
	this._undoStackLength = 0;
};

proto.handleEvent = function ( event ) {
	this.fireEvent( event.type, event );
};

proto.addEventListener = function ( type, fn ) {
	type.split(/\s+/).forEach(type=>{
		let handlers = this._events[ type ],
			target = this._root;
		if ( !fn ) {
			this.didError({
				name: 'Squire: addEventListener with null or undefined fn',
				message: 'Event type: ' + type
			});
			return this;
		}
		if ( !handlers ) {
			handlers = this._events[ type ] = [];
			if ( !customEvents[ type ] ) {
				if ( type === 'selectionchange' ) {
					target = doc;
				}
				target.addEventListener( type, this, {capture:true,passive:'touchstart'===type} );
			}
		}
		handlers.push( fn );
	});
	return this;
};

proto.removeEventListener = function ( type, fn ) {
	let handlers = this._events[ type ];
	let target = this._root;
	let l;
	if ( handlers ) {
		if ( fn ) {
			l = handlers.length;
			while ( l-- ) {
				if ( handlers[l] === fn ) {
					handlers.splice( l, 1 );
				}
			}
		} else {
			handlers.length = 0;
		}
		if ( !handlers.length ) {
			delete this._events[ type ];
			if ( !customEvents[ type ] ) {
				if ( type === 'selectionchange' ) {
					target = doc;
				}
				target.removeEventListener( type, this, true );
			}
		}
	}
	return this;
};

// --- Selection and Path ---

proto.createRange =
		function ( range, startOffset, endContainer, endOffset ) {
	if ( range instanceof win.Range ) {
		return range.cloneRange();
	}
	let domRange = doc.createRange();
	domRange.setStart( range, startOffset );
	if ( endContainer ) {
		domRange.setEnd( endContainer, endOffset );
	} else {
		domRange.setEnd( range, startOffset );
	}
	return domRange;
};

proto.getCursorPosition = function ( range ) {
	if ( ( !range && !( range = this.getSelection() ) ) ||
			!range.getBoundingClientRect ) {
		return null;
	}
	// Get the bounding rect
	let rect = range.getBoundingClientRect();
	let node, parent;
	if ( rect && !rect.top ) {
		this._ignoreChange = true;
		node = doc.createElement( 'SPAN' );
		node.textContent = ZWS;
		insertNodeInRange( range, node );
		rect = node.getBoundingClientRect();
		parent = node.parentNode;
		node.remove(  );
		mergeInlines( parent, range );
	}
	return rect;
};

proto.setSelection = function ( range ) {
	if ( range ) {
		this._lastRange = range;
		// If we're setting selection, that automatically, and synchronously, // triggers a focus event. So just store the selection and mark it as
		// needing restore on focus.
		if ( !this._isFocused ) {
			this._restoreSelection = true;
		} else {
			// iOS bug: if you don't focus the iframe before setting the
			// selection, you can end up in a state where you type but the input
			// doesn't get directed into the contenteditable area but is instead
			// lost in a black hole. Very strange.
			if ( isIOS ) {
				win.focus();
			}
			let sel = win.getSelection();
			if ( sel && sel.setBaseAndExtent ) {
				sel.setBaseAndExtent(
					range.startContainer,
					range.startOffset,
					range.endContainer,
					range.endOffset,
				);
			} else if ( sel ) {
				// This is just for IE11
				sel.removeAllRanges();
				sel.addRange( range );
			}
		}
	}
	return this;
};

proto.getSelection = function () {
	let sel = win.getSelection();
	let root = this._root;
	let range, startContainer, endContainer, node;
	// If not focused, always rely on cached range; another function may
	// have set it but the DOM is not modified until focus again
	if ( this._isFocused && sel && sel.rangeCount ) {
		range = sel.getRangeAt( 0 ).cloneRange();
		startContainer = range.startContainer;
		endContainer = range.endContainer;
		// FF can return the range as being inside an <img>. WTF?
		if ( startContainer && isLeaf( startContainer ) ) {
			range.setStartBefore( startContainer );
		}
		if ( endContainer && isLeaf( endContainer ) ) {
			range.setEndBefore( endContainer );
		}
	}
	if ( range && root.contains( range.commonAncestorContainer ) ) {
		this._lastRange = range;
	} else {
		range = this._lastRange;
		node = range.commonAncestorContainer;
		// Check the editor is in the live document; if not, the range has
		// probably been rewritten by the browser and is bogus
		if ( !doc.contains( node ) ) {
			range = null;
		}
	}
	return range || this.createRange( root.firstChild, 0 );
};

proto.getSelectionClosest = function (selector) {
	let range = this.getSelection();
	return range && getClosest(range.commonAncestorContainer, this._root, selector);
};

proto.selectionContains = function (selector) {
	let range = this.getSelection(),
		node = range && range.commonAncestorContainer;
	if (node && !range.collapsed) {
		node = node.querySelector ? node : node.parentElement;
		// TODO: isNodeContainedInRange( range, node ) for real selection match?
		return !!(node && node.querySelector(selector));
	}
	return false;
};

proto.getSelectedText = function () {
	let range = this.getSelection();
	if ( !range || range.collapsed ) {
		return '';
	}
	let walker = doc.createTreeWalker(
		range.commonAncestorContainer,
		SHOW_TEXT|SHOW_ELEMENT,
		node => isNodeContainedInRange( range, node )
	);
	let startContainer = range.startContainer;
	let endContainer = range.endContainer;
	let node = walker.currentNode = startContainer;
	let textContent = '';
	let addedTextInBlock = false;
	let value;

	if ( !walker.filter( node ) ) {
		node = walker.nextNode();
	}

	while ( node ) {
		if ( node.nodeType === TEXT_NODE ) {
			value = node.data;
			if ( value && ( /\S/.test( value ) ) ) {
				if ( node === endContainer ) {
					value = value.slice( 0, range.endOffset );
				}
				if ( node === startContainer ) {
					value = value.slice( range.startOffset );
				}
				textContent += value;
				addedTextInBlock = true;
			}
		} else if ( node.nodeName === 'BR' ||
				addedTextInBlock && !isInline( node ) ) {
			textContent += '\n';
			addedTextInBlock = false;
		}
		node = walker.nextNode();
	}

	return textContent;
};

proto.getPath = function () {
	return this._path;
};

// --- Workaround for browsers that can't focus empty text nodes ---

// WebKit bug: https://bugs.webkit.org/show_bug.cgi?id=15256

// Walk down the tree starting at the root and remove any ZWS. If the node only
// contained ZWS space then remove it too. We may want to keep one ZWS node at
// the bottom of the tree so the block can be selected. Define that node as the
// keepNode.
let removeZWS = ( root, keepNode ) => {
	let walker = doc.createTreeWalker( root, SHOW_TEXT );
	let parent, node, index;
	while ( node = walker.nextNode() ) {
		while ( ( index = node.data.indexOf( ZWS ) ) > -1  &&
				( !keepNode || node.parentNode !== keepNode ) ) {
			if ( node.length === 1 ) {
				do {
					parent = node.parentNode;
					node.remove(  );
					node = parent;
					walker.currentNode = parent;
				} while ( isInline( node ) && !getLength( node ) );
				break;
			} else {
				node.deleteData( index, 1 );
			}
		}
	}
};

proto._didAddZWS = function () {
	this._hasZWS = true;
};
proto._removeZWS = function () {
	if ( !this._hasZWS ) {
		return;
	}
	removeZWS( this._root );
	this._hasZWS = false;
};

// --- Path change events ---

proto._updatePath = function ( range, force ) {
	if ( !range ) {
		return;
	}
	let anchor = range.startContainer,
		focus = range.endContainer,
		newPath;
	if ( force || anchor !== this._lastAnchorNode ||
			focus !== this._lastFocusNode ) {
		this._lastAnchorNode = anchor;
		this._lastFocusNode = focus;
		newPath = ( anchor && focus ) ? ( anchor === focus ) ?
			getPath( focus, this._root, this._config ) : '(selection)' : '';
		if ( this._path !== newPath ) {
			this._path = newPath;
			this.fireEvent( 'pathChange', { path: newPath } );
		}
	}
	this.fireEvent( range.collapsed ? 'cursor' : 'select', {
		range: range
	});
};

// --- Focus ---

proto.focus = function () {
	this._root.focus({ preventScroll: true });
	return this;
};

proto.blur = function () {
	this._root.blur();
	return this;
};

// --- Bookmarking ---

let startSelectionId = 'squire-selection-start';
let endSelectionId = 'squire-selection-end';

const createBookmarkNodes = self => [
	self.createElement( 'INPUT', {
		id: startSelectionId,
		type: 'hidden'
	}),
	self.createElement( 'INPUT', {
		id: endSelectionId,
		type: 'hidden'
	})
];

proto._saveRangeToBookmark = function ( range ) {
	let [startNode, endNode] = createBookmarkNodes(this),
		temp;

	insertNodeInRange( range, startNode );
	range.collapse( false );
	insertNodeInRange( range, endNode );

	// In a collapsed range, the start is sometimes inserted after the end!
	if ( startNode.compareDocumentPosition( endNode ) &
			DOCUMENT_POSITION_PRECEDING ) {
		startNode.id = endSelectionId;
		endNode.id = startSelectionId;
		temp = startNode;
		startNode = endNode;
		endNode = temp;
	}

	range.setStartAfter( startNode );
	range.setEndBefore( endNode );
};

proto._getRangeAndRemoveBookmark = function ( range ) {
	let root = this._root,
		start = root.querySelector( '#' + startSelectionId ),
		end = root.querySelector( '#' + endSelectionId );

	if ( start && end ) {
		let startContainer = start.parentNode,
			endContainer = end.parentNode,
			startOffset = indexOf( startContainer.childNodes, start ),
			endOffset = indexOf( endContainer.childNodes, end );

		if ( startContainer === endContainer ) {
			--endOffset;
		}

		start.remove();
		end.remove();

		if ( !range ) {
			range = doc.createRange();
		}
		range.setStart( startContainer, startOffset );
		range.setEnd( endContainer, endOffset );

		// Merge any text nodes we split
		mergeInlines( startContainer, range );
		if ( startContainer !== endContainer ) {
			mergeInlines( endContainer, range );
		}

		// If we didn't split a text node, we should move into any adjacent
		// text node to current selection point
		if ( range.collapsed ) {
			startContainer = range.startContainer;
			if ( startContainer.nodeType === TEXT_NODE ) {
				endContainer = startContainer.childNodes[ range.startOffset ];
				if ( !endContainer || endContainer.nodeType !== TEXT_NODE ) {
					endContainer =
						startContainer.childNodes[ range.startOffset - 1 ];
				}
				if ( endContainer && endContainer.nodeType === TEXT_NODE ) {
					range.setStart( endContainer, 0 );
					range.collapse( true );
				}
			}
		}
	}
	return range || null;
};

// --- Undo ---

proto._keyUpDetectChange = event => {
	let code = event.keyCode;
	// Presume document was changed if:
	// 1. A modifier key (other than shift) wasn't held down
	// 2. The key pressed is not in range 16<=x<=20 (control keys)
	// 3. The key pressed is not in range 33<=x<=45 (navigation keys)
	if ( !event[osKey] && !event.altKey &&
			( code < 16 || code > 20 ) &&
			( code < 33 || code > 45 ) ) {
		this._docWasChanged();
	}
};

proto._docWasChanged = function () {
	nodeCategoryCache = new WeakMap();
	if ( this._ignoreAllChanges ) {
		return;
	}

	if ( this._ignoreChange ) {
		this._ignoreChange = false;
		return;
	}
	if ( this._isInUndoState ) {
		this._isInUndoState = false;
		this.fireEvent( 'undoStateChange', {
			canUndo: true,
			canRedo: false
		});
	}
	this.fireEvent( 'input' );
};

// Leaves bookmark
proto._recordUndoState = function ( range, replace ) {
	// Don't record if we're already in an undo state
	if ( !this._isInUndoState|| replace ) {
		// Advance pointer to new position
		let undoIndex = this._undoIndex;
		let undoStack = this._undoStack;
		let undoConfig = this._config.undo;
		let undoThreshold = undoConfig.documentSizeThreshold;
		let undoLimit = undoConfig.undoLimit;
		let html;

		if ( !replace ) {
			++undoIndex;
		}

		// Truncate stack if longer (i.e. if has been previously undone)
		if ( undoIndex < this._undoStackLength ) {
			undoStack.length = this._undoStackLength = undoIndex;
		}

		// Get data
		if ( range ) {
			this._saveRangeToBookmark( range );
		}
		html = this._getHTML();

		// If this document is above the configured size threshold,
		// limit the number of saved undo states.
		// Threshold is in bytes, JS uses 2 bytes per character
		if ( undoThreshold > -1 && html.length * 2 > undoThreshold ) {
			if ( undoLimit > -1 && undoIndex > undoLimit ) {
				undoStack.splice( 0, undoIndex - undoLimit );
				undoIndex = undoLimit;
				this._undoStackLength = undoLimit;
			}
		}

		// Save data
		undoStack[ undoIndex ] = html;
		this._undoIndex = undoIndex;
		++this._undoStackLength;
		this._isInUndoState = true;
	}
};

proto.saveUndoState = function ( range ) {
	if ( range === undefined ) {
		range = this.getSelection();
	}
	this._recordUndoState( range, this._isInUndoState );
	this._getRangeAndRemoveBookmark( range );

	return this;
};

proto.undo = function () {
	// Sanity check: must not be at beginning of the history stack
	if ( this._undoIndex !== 0 || !this._isInUndoState ) {
		// Make sure any changes since last checkpoint are saved.
		this._recordUndoState( this.getSelection(), false );

		--this._undoIndex;
		this._setHTML( this._undoStack[ this._undoIndex ] );
		let range = this._getRangeAndRemoveBookmark();
		if ( range ) {
			this.setSelection( range );
		}
		this._isInUndoState = true;
		this.fireEvent( 'undoStateChange', {
			canUndo: this._undoIndex !== 0,
			canRedo: true
		});
		this.fireEvent( 'input' );
	}
	return this;
};

proto.redo = function () {
	// Sanity check: must not be at end of stack and must be in an undo
	// state.
	let undoIndex = this._undoIndex,
		undoStackLength = this._undoStackLength;
	if ( undoIndex + 1 < undoStackLength && this._isInUndoState ) {
		++this._undoIndex;
		this._setHTML( this._undoStack[ this._undoIndex ] );
		let range = this._getRangeAndRemoveBookmark();
		if ( range ) {
			this.setSelection( range );
		}
		this.fireEvent( 'undoStateChange', {
			canUndo: true,
			canRedo: undoIndex + 2 < undoStackLength
		});
		this.fireEvent( 'input' );
	}
	return this;
};

// --- Inline formatting ---

// Looks for matching tag and attributes, so won't work
// if <strong> instead of <b> etc.
proto.hasFormat = function ( tag, attributes, range ) {
	// 1. Normalise the arguments and get selection
	tag = tag.toUpperCase();
	if ( !attributes ) { attributes = {}; }
	if ( !range && !( range = this.getSelection() ) ) {
		return false;
	}

	// Sanitize range to prevent weird IE artifacts
	if ( !range.collapsed &&
			range.startContainer.nodeType === TEXT_NODE &&
			range.startOffset === range.startContainer.length &&
			range.startContainer.nextSibling ) {
		range.setStartBefore( range.startContainer.nextSibling );
	}
	if ( !range.collapsed &&
			range.endContainer.nodeType === TEXT_NODE &&
			range.endOffset === 0 &&
			range.endContainer.previousSibling ) {
		range.setEndAfter( range.endContainer.previousSibling );
	}

	// If the common ancestor is inside the tag we require, we definitely
	// have the format.
	let root = this._root;
	let common = range.commonAncestorContainer;
	let walker, node;
	if ( getNearest( common, root, tag, attributes ) ) {
		return true;
	}

	// If common ancestor is a text node and doesn't have the format, we
	// definitely don't have it.
	if ( common.nodeType === TEXT_NODE ) {
		return false;
	}

	// Otherwise, check each text node at least partially contained within
	// the selection and make sure all of them have the format we want.
	walker = doc.createTreeWalker( common, SHOW_TEXT, node => isNodeContainedInRange( range, node ) );

	let seenNode = false;
	while ( node = walker.nextNode() ) {
		if ( !getNearest( node, root, tag, attributes ) ) {
			return false;
		}
		seenNode = true;
	}

	return seenNode;
};

// Extracts the font-family and font-size (if any) of the element
// holding the cursor. If there's a selection, returns an empty object.
proto.getFontInfo = function ( range ) {
	let fontInfo = {
		color: undefined,
		backgroundColor: undefined,
		family: undefined,
		size: undefined
	};
	let seenAttributes = 0;
	let element, style, attr;

	if ( !range && !( range = this.getSelection() ) ) {
		return fontInfo;
	}

	element = range.commonAncestorContainer;
	if ( range.collapsed || element.nodeType === TEXT_NODE ) {
		if ( element.nodeType === TEXT_NODE ) {
			element = element.parentNode;
		}
		while ( seenAttributes < 4 && element ) {
			if ( style = element.style ) {
				if ( !fontInfo.color && ( attr = style.color ) ) {
					fontInfo.color = attr;
					++seenAttributes;
				}
				if ( !fontInfo.backgroundColor &&
						( attr = style.backgroundColor ) ) {
					fontInfo.backgroundColor = attr;
					++seenAttributes;
				}
				if ( !fontInfo.family && ( attr = style.fontFamily ) ) {
					fontInfo.family = attr;
					++seenAttributes;
				}
				if ( !fontInfo.size && ( attr = style.fontSize ) ) {
					fontInfo.size = attr;
					++seenAttributes;
				}
			}
			element = element.parentNode;
		}
	}
	return fontInfo;
};

proto._addFormat = function ( tag, attributes, range ) {
	// If the range is collapsed we simply insert the node by wrapping
	// it round the range and focus it.
	let root = this._root;
	let el, walker, startContainer, endContainer, startOffset, endOffset,
		node, needsFormat, block;

	if ( range.collapsed ) {
		el = fixCursor( this.createElement( tag, attributes ), root );
		insertNodeInRange( range, el );
		range.setStart( el.firstChild, el.firstChild.length );
		range.collapse( true );

		// Clean up any previous formats that may have been set on this block
		// that are unused.
		block = el;
		while ( isInline( block ) ) {
			block = block.parentNode;
		}
		removeZWS( block, el );
	}
	// Otherwise we find all the textnodes in the range (splitting
	// partially selected nodes) and if they're not already formatted
	// correctly we wrap them in the appropriate tag.
	else {
		// Create an iterator to walk over all the text nodes under this
		// ancestor which are in the range and not already formatted
		// correctly.
		//
		// In Blink/WebKit, empty blocks may have no text nodes, just a <br>.
		// Therefore we wrap this in the tag as well, as this will then cause it
		// to apply when the user types something in the block, which is
		// presumably what was intended.
		//
		// IMG tags are included because we may want to create a link around
		// them, and adding other styles is harmless.
		walker = doc.createTreeWalker(
			range.commonAncestorContainer,
			SHOW_TEXT|SHOW_ELEMENT,
			node => ( node.nodeType === TEXT_NODE ||
						node.nodeName === 'BR' ||
						node.nodeName === 'IMG'
					) && isNodeContainedInRange( range, node )
		);

		// Start at the beginning node of the range and iterate through
		// all the nodes in the range that need formatting.
		startContainer = range.startContainer;
		startOffset = range.startOffset;
		endContainer = range.endContainer;
		endOffset = range.endOffset;

		// Make sure we start with a valid node.
		walker.currentNode = startContainer;
		if ( !walker.filter( startContainer ) ) {
			startContainer = walker.nextNode();
			startOffset = 0;
		}

		// If there are no interesting nodes in the selection, abort
		if ( !startContainer ) {
			return range;
		}

		do {
			node = walker.currentNode;
			needsFormat = !getNearest( node, root, tag, attributes );
			if ( needsFormat ) {
				// <br> can never be a container node, so must have a text node
				// if node == (end|start)Container
				if ( node === endContainer && node.length > endOffset ) {
					node.splitText( endOffset );
				}
				if ( node === startContainer && startOffset ) {
					node = node.splitText( startOffset );
					if ( endContainer === startContainer ) {
						endContainer = node;
						endOffset -= startOffset;
					}
					startContainer = node;
					startOffset = 0;
				}
				el = this.createElement( tag, attributes );
				node.replaceWith( el );
				el.append( node );
			}
		} while ( walker.nextNode() );

		// If we don't finish inside a text node, offset may have changed.
		if ( endContainer.nodeType !== TEXT_NODE ) {
			if ( node.nodeType === TEXT_NODE ) {
				endContainer = node;
				endOffset = node.length;
			} else {
				// If <br>, we must have just wrapped it, so it must have only
				// one child
				endContainer = node.parentNode;
				endOffset = 1;
			}
		}

		// Now set the selection to as it was before
		range = this.createRange(
			startContainer, startOffset, endContainer, endOffset );
	}
	return range;
};

proto._removeFormat = function ( tag, attributes, range, partial ) {
	// Add bookmark
	this._saveRangeToBookmark( range );

	// We need a node in the selection to break the surrounding
	// formatted text.
	let fixer;
	if ( range.collapsed ) {
		if ( isWebKit ) {
			fixer = doc.createTextNode( ZWS );
			this._didAddZWS();
		} else {
			fixer = doc.createTextNode( '' );
		}
		insertNodeInRange( range, fixer );
	}

	// Find block-level ancestor of selection
	let root = range.commonAncestorContainer;
	while ( isInline( root ) ) {
		root = root.parentNode;
	}

	// Find text nodes inside formatTags that are not in selection and
	// add an extra tag with the same formatting.
	let startContainer = range.startContainer,
		startOffset = range.startOffset,
		endContainer = range.endContainer,
		endOffset = range.endOffset,
		toWrap = [],
		examineNode = function ( node, exemplar ) {
			// If the node is completely contained by the range then
			// we're going to remove all formatting so ignore it.
			if ( isNodeContainedInRange( range, node, false ) ) {
				return;
			}

			let isText = ( node.nodeType === TEXT_NODE ),
				child, next;

			// If not at least partially contained, wrap entire contents
			// in a clone of the tag we're removing and we're done.
			if ( !isNodeContainedInRange( range, node ) ) {
				// Ignore bookmarks and empty text nodes
				if ( node.nodeName !== 'INPUT' &&
						( !isText || node.data ) ) {
					toWrap.push([ exemplar, node ]);
				}
				return;
			}

			// Split any partially selected text nodes.
			if ( isText ) {
				if ( node === endContainer && endOffset !== node.length ) {
					toWrap.push([ exemplar, node.splitText( endOffset ) ]);
				}
				if ( node === startContainer && startOffset ) {
					node.splitText( startOffset );
					toWrap.push([ exemplar, node ]);
				}
			}
			// If not a text node, recurse onto all children.
			// Beware, the tree may be rewritten with each call
			// to examineNode, hence find the next sibling first.
			else {
				for ( child = node.firstChild; child; child = next ) {
					next = child.nextSibling;
					examineNode( child, exemplar );
				}
			}
		},
		formatTags = Array.prototype.filter.call(
			root.getElementsByTagName( tag ), function ( el ) {
				return isNodeContainedInRange( range, el ) &&
					hasTagAttributes( el, tag, attributes );
			}
		);

	if ( !partial ) {
		formatTags.forEach( function ( node ) {
			examineNode( node, node );
		});
	}

	// Now wrap unselected nodes in the tag
	toWrap.forEach( function ( item ) {
		// [ exemplar, node ] tuple
		let el = item[0].cloneNode( false ),
			node = item[1];
		node.replaceWith( el );
		el.append( node );
	});
	// and remove old formatting tags.
	formatTags.forEach( function ( el ) {
		el.replaceWith( empty( el ) );
	});

	// Merge adjacent inlines:
	this._getRangeAndRemoveBookmark( range );
	if ( fixer ) {
		range.collapse( false );
	}
	mergeInlines( root, range );

	return range;
};

proto.changeFormat = function ( add, remove, range, partial ) {
	// Normalise the arguments and get selection
	if ( !range && !( range = this.getSelection() ) ) {
		return this;
	}

	// Save undo checkpoint
	this.saveUndoState( range );

	if ( remove ) {
		range = this._removeFormat( remove.tag.toUpperCase(),
			remove.attributes || {}, range, partial );
	}
	if ( add ) {
		range = this._addFormat( add.tag.toUpperCase(),
			add.attributes || {}, range );
	}

	this.setSelection( range );
	this._updatePath( range, true );

	return this;
};

// --- Block formatting ---

let tagAfterSplit = {
	DT:  'DD',
	DD:  'DT',
	LI:  'LI',
	PRE: 'PRE'
};

let splitBlock = ( self, block, node, offset ) => {
	let splitTag = tagAfterSplit[ block.nodeName ],
		splitProperties = null,
		nodeAfterSplit = split( node, offset, block.parentNode, self._root ),
		config = self._config;

	if ( !splitTag ) {
		splitTag = config.blockTag;
		splitProperties = config.blockAttributes;
	}

	// Make sure the new node is the correct type.
	if ( !hasTagAttributes( nodeAfterSplit, splitTag, splitProperties ) ) {
		block = createElement( doc,
			splitTag, splitProperties );
		if ( nodeAfterSplit.dir ) {
			block.dir = nodeAfterSplit.dir;
		}
		nodeAfterSplit.replaceWith( block );
		block.append( empty( nodeAfterSplit ) );
		nodeAfterSplit = block;
	}
	return nodeAfterSplit;
};

proto.forEachBlock = function ( fn, mutates, range ) {
	if ( !range && !( range = this.getSelection() ) ) {
		return this;
	}

	// Save undo checkpoint
	if ( mutates ) {
		this.saveUndoState( range );
	}

	let root = this._root;
	let start = getStartBlockOfRange( range, root );
	let end = getEndBlockOfRange( range, root );
	if ( start && end ) {
		do {
			if ( fn( start ) || start === end ) { break; }
		} while ( start = getNextBlock( start, root ) );
	}

	if ( mutates ) {
		this.setSelection( range );

		// Path may have changed
		this._updatePath( range, true );
	}
	return this;
};

proto.modifyBlocks = function ( modify, range ) {
	if ( !range && !( range = this.getSelection() ) ) {
		return this;
	}

	// 1. Save undo checkpoint and bookmark selection
	this._recordUndoState( range, this._isInUndoState );

	let root = this._root;
	let frag;

	// 2. Expand range to block boundaries
	expandRangeToBlockBoundaries( range, root );

	// 3. Remove range.
	moveRangeBoundariesUpTree( range, root, root, root );
	frag = extractContentsOfRange( range, root, root );

	// 4. Modify tree of fragment and reinsert.
	insertNodeInRange( range, modify.call( this, frag ) );

	// 5. Merge containers at edges
	if ( range.endOffset < range.endContainer.childNodes.length ) {
		mergeContainers( range.endContainer.childNodes[ range.endOffset ], root );
	}
	mergeContainers( range.startContainer.childNodes[ range.startOffset ], root );

	// 6. Restore selection
	this._getRangeAndRemoveBookmark( range );
	this.setSelection( range );
	this._updatePath( range, true );

	return this;
};

let increaseBlockQuoteLevel = function ( frag ) {
	return this.createElement( 'BLOCKQUOTE',
		this._config.tagAttributes.blockquote, [
			frag
		]);
};

let decreaseBlockQuoteLevel = function ( frag ) {
	var blockquotes = frag.querySelectorAll( 'blockquote' );
	Array.prototype.filter.call( blockquotes, el =>
		!getClosest( el.parentNode, frag, 'BLOCKQUOTE' )
	).forEach( el => el.replaceWith( empty( el ) ) );
	return frag;
};

let makeList = ( self, frag, type ) => {
	let walker = getBlockWalker( frag, self._root ),
		node, tag, prev, newLi,
		tagAttributes = self._config.tagAttributes,
		listAttrs = tagAttributes[ type.toLowerCase() ],
		listItemAttrs = tagAttributes.li;

	while ( node = walker.nextNode() ) {
		if ( node.parentNode.nodeName === 'LI' ) {
			node = node.parentNode;
			walker.currentNode = node.lastChild;
		}
		if ( node.nodeName !== 'LI' ) {
			newLi = self.createElement( 'LI', listItemAttrs );
			if ( node.dir ) {
				newLi.dir = node.dir;
			}

			// Have we replaced the previous block with a new <ul>/<ol>?
			if ( ( prev = node.previousSibling ) && prev.nodeName === type ) {
				prev.append( newLi );
				node.remove();
			}
			// Otherwise, replace this block with the <ul>/<ol>
			else {
				node.replaceWith(
					self.createElement( type, listAttrs, [
						newLi
					])
				);
			}
			newLi.append( empty( node ) );
			walker.currentNode = newLi;
		} else {
			node = node.parentNode;
			tag = node.nodeName;
			if ( tag !== type && ( /^[OU]L$/.test( tag ) ) ) {
				node.replaceWith(
					self.createElement( type, listAttrs, [ empty( node ) ] )
				);
			}
		}
	}
};

let makeUnorderedList = function ( frag ) {
	makeList( this, frag, 'UL' );
	return frag;
};

let makeOrderedList = function ( frag ) {
	makeList( this, frag, 'OL' );
	return frag;
};

let removeList = function ( frag ) {
	let lists = frag.querySelectorAll( 'UL, OL' ),
		items =  frag.querySelectorAll( 'LI' ),
		root = this._root,
		i, l, list, listFrag, item;
	for ( i = 0, l = lists.length; i < l; ++i ) {
		list = lists[i];
		listFrag = empty( list );
		fixContainer( listFrag, root );
		list.replaceWith( listFrag );
	}

	for ( i = 0, l = items.length; i < l; ++i ) {
		item = items[i];
		if ( isBlock( item ) ) {
			item.replaceWith(
				this.createDefaultBlock([ empty( item ) ])
			);
		} else {
			fixContainer( item, root );
			item.replaceWith( empty( item ) );
		}
	}
	return frag;
};

let getListSelection = ( range, root ) => {
	// Get start+end li in single common ancestor
	let list = range.commonAncestorContainer;
	let startLi = range.startContainer;
	let endLi = range.endContainer;
	while ( list && list !== root && !/^[OU]L$/.test( list.nodeName ) ) {
		list = list.parentNode;
	}
	if ( !list || list === root ) {
		return null;
	}
	if ( startLi === list ) {
		startLi = startLi.childNodes[ range.startOffset ];
	}
	if ( endLi === list ) {
		endLi = endLi.childNodes[ range.endOffset ];
	}
	while ( startLi && startLi.parentNode !== list ) {
		startLi = startLi.parentNode;
	}
	while ( endLi && endLi.parentNode !== list ) {
		endLi = endLi.parentNode;
	}
	return [ list, startLi, endLi ];
};

proto.increaseListLevel = function ( range ) {
	if ( !range && !( range = this.getSelection() ) ) {
		return this.focus();
	}

	let root = this._root;
	let listSelection = getListSelection( range, root );
	if ( !listSelection ) {
		return this.focus();
	}

	let list = listSelection[0];
	let startLi = listSelection[1];
	let endLi = listSelection[2];
	if ( !startLi || startLi === list.firstChild ) {
		return this.focus();
	}

	// Save undo checkpoint and bookmark selection
	this._recordUndoState( range, this._isInUndoState );

	// Increase list depth
	let type = list.nodeName;
	let newParent = startLi.previousSibling;
	let listAttrs, next;
	if ( newParent.nodeName !== type ) {
		listAttrs = this._config.tagAttributes[ type.toLowerCase() ];
		newParent = this.createElement( type, listAttrs );
		startLi.before( newParent );
	}
	do {
		next = startLi === endLi ? null : startLi.nextSibling;
		newParent.append( startLi );
	} while ( ( startLi = next ) );
	next = newParent.nextSibling;
	if ( next ) {
		mergeContainers( next, root );
	}

	// Restore selection
	this._getRangeAndRemoveBookmark( range );
	this.setSelection( range );
	this._updatePath( range, true );

	return this.focus();
};

proto.decreaseListLevel = function ( range ) {
	if ( !range && !( range = this.getSelection() ) ) {
		return this.focus();
	}

	let root = this._root;
	let listSelection = getListSelection( range, root );
	if ( !listSelection ) {
		return this.focus();
	}

	let list = listSelection[0];
	let startLi = listSelection[1];
	let endLi = listSelection[2];
	let newParent, next, insertBefore, makeNotList;
	if ( !startLi ) {
		startLi = list.firstChild;
	}
	if ( !endLi ) {
		endLi = list.lastChild;
	}

	// Save undo checkpoint and bookmark selection
	this._recordUndoState( range, this._isInUndoState );

	if ( startLi ) {
		// Find the new parent list node
		newParent = list.parentNode;

		// Split list if necesary
		insertBefore = !endLi.nextSibling ?
			list.nextSibling :
			split( list, endLi.nextSibling, newParent, root );

		if ( newParent !== root && newParent.nodeName === 'LI' ) {
			newParent = newParent.parentNode;
			while ( insertBefore ) {
				next = insertBefore.nextSibling;
				endLi.append( insertBefore );
				insertBefore = next;
			}
			insertBefore = list.parentNode.nextSibling;
		}

		makeNotList = !/^[OU]L$/.test( newParent.nodeName );
		do {
			next = startLi === endLi ? null : startLi.nextSibling;
			startLi.remove(  );
			if ( makeNotList && startLi.nodeName === 'LI' ) {
				startLi = this.createDefaultBlock([ empty( startLi ) ]);
			}
			newParent.insertBefore( startLi, insertBefore );
		} while (( startLi = next ));
	}

	if ( !list.firstChild ) {
		list.remove();
	}

	if ( insertBefore ) {
		mergeContainers( insertBefore, root );
	}

	// Restore selection
	this._getRangeAndRemoveBookmark( range );
	this.setSelection( range );
	this._updatePath( range, true );

	return this.focus();
};

proto._ensureBottomLine = function () {
	let root = this._root;
	let last = root.lastElementChild;
	if ( !last ||
			last.nodeName !== this._config.blockTag || !isBlock( last ) ) {
		root.append( this.createDefaultBlock() );
	}
};

// --- Keyboard interaction ---

proto.setKeyHandler = function ( key, fn ) {
	this._keyHandlers[ key ] = fn;
	return this;
};

// --- Get/Set data ---

proto._getHTML = function () {
	return this._root.innerHTML;
};

proto._setHTML = function ( html ) {
	let root = this._root;
	let node = root;
	node.innerHTML = html;
	do {
		fixCursor( node, root );
	} while ( node = getNextBlock( node, root ) );
	this._ignoreChange = true;
};

proto.getHTML = function ( withBookMark ) {
	let html, range;
	if ( withBookMark && ( range = this.getSelection() ) ) {
		this._saveRangeToBookmark( range );
	}
	html = this._getHTML().replace( /\u200B/g, '' );
	if ( range ) {
		this._getRangeAndRemoveBookmark( range );
	}
	return html;
};

proto.setHTML = function ( html ) {
	let config = this._config;
	let sanitizeToDOMFragment = config.isSetHTMLSanitized ?
			config.sanitizeToDOMFragment : null;
	let root = this._root;
	let div, frag, child;

	// Parse HTML into DOM tree
	if ( typeof sanitizeToDOMFragment === 'function' ) {
		frag = sanitizeToDOMFragment( html, false, this );
	} else {
		div = this.createElement( 'DIV' );
		div.innerHTML = html;
		frag = doc.createDocumentFragment();
		frag.append( empty( div ) );
	}

	cleanTree( frag, config );
	cleanupBRs( frag, root, false );

	fixContainer( frag, root );

	// Fix cursor
	let node = frag;
	while ( node = getNextBlock( node, root ) ) {
		fixCursor( node, root );
	}

	// Don't fire an input event
	this._ignoreChange = true;

	// Remove existing root children
	while ( child = root.lastChild ) {
		child.remove(  );
	}

	// And insert new content
	root.append( frag );
	fixCursor( root, root );

	// Reset the undo stack
	this._undoIndex = -1;
	this._undoStack.length = 0;
	this._undoStackLength = 0;
	this._isInUndoState = false;

	// Record undo state
	let range = this._getRangeAndRemoveBookmark() ||
		this.createRange( root.firstChild, 0 );
	this.saveUndoState( range );
	// IE will also set focus when selecting text so don't use
	// setSelection. Instead, just store it in lastSelection, so if
	// anything calls getSelection before first focus, we have a range
	// to return.
	this._lastRange = range;
	this._restoreSelection = true;
	this._updatePath( range, true );

	return this;
};

proto.insertElement = function ( el, range ) {
	if ( !range ) {
		range = this.getSelection();
	}
	range.collapse( true );
	if ( isInline( el ) ) {
		insertNodeInRange( range, el );
		range.setStartAfter( el );
	} else {
		// Get containing block node.
		let root = this._root;
		let splitNode = getStartBlockOfRange( range, root ) || root;
		let parent, nodeAfterSplit;
		// While at end of container node, move up DOM tree.
		while ( splitNode !== root && !splitNode.nextSibling ) {
			splitNode = splitNode.parentNode;
		}
		// If in the middle of a container node, split up to root.
		if ( splitNode !== root ) {
			parent = splitNode.parentNode;
			nodeAfterSplit = split( parent, splitNode.nextSibling, root, root );
		}
		if ( nodeAfterSplit ) {
			nodeAfterSplit.before( el );
		} else {
			root.append( el );
			// Insert blank line below block.
			nodeAfterSplit = this.createDefaultBlock();
			root.append( nodeAfterSplit );
		}
		range.setStart( nodeAfterSplit, 0 );
		range.setEnd( nodeAfterSplit, 0 );
		moveRangeBoundariesDownTree( range );
	}
	this.focus();
	this.setSelection( range );
	this._updatePath( range );

	return this;
};

proto.insertImage = function ( src, attributes ) {
	let img = this.createElement( 'IMG', mergeObjects({
		src: src
	}, attributes, true ));
	this.insertElement( img );
	return img;
};

proto.linkRegExp = /\b(?:((?:(?:ht|f)tps?:\/\/|www\d{0,3}[.]|[a-z0-9][a-z0-9.-]*[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:[^\s?&`!()[\]{};:'".,<>«»“”‘’]|\([^\s()<>]+\)))|([\w\-.%+]+@(?:[\w-]+\.)+[a-z]{2,}\b(?:[?][^&?\s]+=[^\s?&`!()[\]{};:'".,<>«»“”‘’]+(?:&[^&?\s]+=[^\s?&`!()[\]{};:'".,<>«»“”‘’]+)*)?))/i;

let addLinks = ( frag, root, self ) => {
	let walker = doc.createTreeWalker( frag, SHOW_TEXT, node => !getClosest( node, root, 'A' ));
	let linkRegExp = self.linkRegExp;
	let defaultAttributes = self._config.tagAttributes.a;
	let node, data, parent, match, index, endIndex, child;
	if ( !linkRegExp ) {
		return;
	}
	while (( node = walker.nextNode() )) {
		data = node.data;
		parent = node.parentNode;
		while (( match = linkRegExp.exec( data ) )) {
			index = match.index;
			endIndex = index + match[0].length;
			if ( index ) {
				child = doc.createTextNode( data.slice( 0, index ) );
				parent.insertBefore( child, node );
			}
			child = self.createElement( 'A', mergeObjects({
				href: match[1] ?
					/^(?:ht|f)tps?:/i.test( match[1] ) ?
						match[1] :
						'http://' + match[1] :
					'mailto:' + match[0]
			}, defaultAttributes, false ));
			child.textContent = data.slice( index, endIndex );
			parent.insertBefore( child, node );
			node.data = data = data.slice( endIndex );
		}
	}
};

// Insert HTML at the cursor location. If the selection is not collapsed
// insertTreeFragmentIntoRange will delete the selection so that it is replaced
// by the html being inserted.
proto.insertHTML = function ( html, isPaste ) {
	let config = this._config;
	let sanitizeToDOMFragment = config.isInsertedHTMLSanitized ?
			config.sanitizeToDOMFragment : null;
	let range = this.getSelection();
	let startFragmentIndex, endFragmentIndex;
	let div, frag, root, node, event;

	// Edge doesn't just copy the fragment, but includes the surrounding guff
	// including the full <head> of the page. Need to strip this out. If
	// available use DOMPurify to parse and sanitise.
	if ( typeof sanitizeToDOMFragment === 'function' ) {
		frag = sanitizeToDOMFragment( html, isPaste, this );
	} else {
		if ( isPaste ) {
			startFragmentIndex = html.indexOf( '<!--StartFragment-->' );
			endFragmentIndex = html.lastIndexOf( '<!--EndFragment-->' );
			if ( startFragmentIndex > -1 && endFragmentIndex > -1 ) {
				html = html.slice( startFragmentIndex + 20, endFragmentIndex );
			}
		}
		// Wrap with <tr> if html contains dangling <td> tags
		if ( /<\/td>((?!<\/tr>)[\s\S])*$/i.test( html ) ) {
			html = '<TR>' + html + '</TR>';
		}
		// Wrap with <table> if html contains dangling <tr> tags
		if ( /<\/tr>((?!<\/table>)[\s\S])*$/i.test( html ) ) {
			html = '<TABLE>' + html + '</TABLE>';
		}
		// Parse HTML into DOM tree
		div = this.createElement( 'DIV' );
		div.innerHTML = html;
		frag = doc.createDocumentFragment();
		frag.append( empty( div ) );
	}

	// Record undo checkpoint
	this.saveUndoState( range );

	try {
		root = this._root;
		node = frag;
		event = {
			fragment: frag,
			preventDefault: function () {
				this.defaultPrevented = true;
			},
			defaultPrevented: false
		};

		addLinks( frag, frag, this );
		cleanTree( frag, config );
		cleanupBRs( frag, root, false );
		removeEmptyInlines( frag );
		frag.normalize();

		while ( node = getNextBlock( node, frag ) ) {
			fixCursor( node, root );
		}

		if ( isPaste ) {
			this.fireEvent( 'willPaste', event );
		}

		if ( !event.defaultPrevented ) {
			insertTreeFragmentIntoRange( range, event.fragment, root );
			range.collapse( false );

			// After inserting the fragment, check whether the cursor is inside
			// an <a> element and if so if there is an equivalent cursor
			// position after the <a> element. If there is, move it there.
			moveRangeBoundaryOutOf( range, 'A', root );

			this._ensureBottomLine();
		}

		this.setSelection( range );
		this._updatePath( range, true );
		// Safari sometimes loses focus after paste. Weird.
		if ( isPaste ) {
			this.focus();
		}
	} catch ( error ) {
		this.didError( error );
	}
	return this;
};

let escapeHTML = text => text.replace( '&', '&amp;' )
   .replace( '<', '&lt;' )
   .replace( '>', '&gt;' )
   .replace( '"', '&quot;' );

proto.insertPlainText = function ( plainText, isPaste ) {
	let range = this.getSelection();
	if ( range.collapsed &&
			getClosest( range.startContainer, this._root, 'PRE' ) ) {
		let node = range.startContainer;
		let offset = range.startOffset;
		let text, event;
		if ( !node || node.nodeType !== TEXT_NODE ) {
			text = doc.createTextNode( '' );
			node && node.childNodes[ offset ].before( text );
			node = text;
			offset = 0;
		}
		event = {
			text: plainText,
			preventDefault: function () {
				this.defaultPrevented = true;
			},
			defaultPrevented: false
		};
		if ( isPaste ) {
			this.fireEvent( 'willPaste', event );
		}

		if ( !event.defaultPrevented ) {
			plainText = event.text;
			node.insertData( offset, plainText );
			range.setStart( node, offset + plainText.length );
			range.collapse( true );
		}
		this.setSelection( range );
		return this;
	}
	let lines = plainText.split( '\n' );
	let config = this._config;
	let tag = config.blockTag;
	let attributes = config.blockAttributes;
	let closeBlock  = '</' + tag + '>';
	let openBlock = '<' + tag;
	let attr, i, l, line;

	for ( attr in attributes ) {
		openBlock += ' ' + attr + '="' +
			escapeHTML( attributes[ attr ] ) +
		'"';
	}
	openBlock += '>';

	for ( i = 0, l = lines.length; i < l; ++i ) {
		line = lines[i];
		line = escapeHTML( line ).replace( / (?= )/g, '&nbsp;' );
		// We don't wrap the first line in the block, so if it gets inserted
		// into a blank line it keeps that line's formatting.
		// Wrap each line in <div></div>
		if ( i ) {
			line = openBlock + ( line || '<BR>' ) + closeBlock;
		}
		lines[i] = line;
	}
	return this.insertHTML( lines.join( '' ), isPaste );
};

// --- Formatting ---

let command = ( method, arg, arg2 ) => function () {
	this[ method ]( arg, arg2 );
	return this.focus();
};

proto.addStyles = function ( styles ) {
	if ( styles ) {
		let head = doc.documentElement.firstChild,
			style = this.createElement( 'STYLE', {
				type: 'text/css'
			});
		style.append( doc.createTextNode( styles ) );
		head.append( style );
	}
	return this;
};

proto.bold = command( 'changeFormat', { tag: 'B' } );
proto.italic = command( 'changeFormat', { tag: 'I' } );
proto.underline = command( 'changeFormat', { tag: 'U' } );
proto.strikethrough = command( 'changeFormat', { tag: 'S' } );
proto.subscript = command( 'changeFormat', { tag: 'SUB' }, { tag: 'SUP' } );
proto.superscript = command( 'changeFormat', { tag: 'SUP' }, { tag: 'SUB' } );

proto.removeBold = command( 'changeFormat', null, { tag: 'B' } );
proto.removeItalic = command( 'changeFormat', null, { tag: 'I' } );
proto.removeUnderline = command( 'changeFormat', null, { tag: 'U' } );
proto.removeStrikethrough = command( 'changeFormat', null, { tag: 'S' } );
proto.removeSubscript = command( 'changeFormat', null, { tag: 'SUB' } );
proto.removeSuperscript = command( 'changeFormat', null, { tag: 'SUP' } );

proto.makeLink = function ( url, attributes ) {
	let range = this.getSelection();
	if ( range.collapsed ) {
		let protocolEnd = url.indexOf( ':' ) + 1;
		if ( protocolEnd ) {
			while ( url[ protocolEnd ] === '/' ) { ++protocolEnd; }
		}
		insertNodeInRange(
			range,
			doc.createTextNode( url.slice( protocolEnd ) )
		);
	}
	attributes = mergeObjects(
		mergeObjects({
			href: url
		}, attributes, true ),
		this._config.tagAttributes.a,
		false
	);

	this.changeFormat({
		tag: 'A',
		attributes: attributes
	}, {
		tag: 'A'
	}, range );
	return this.focus();
};
proto.removeLink = function () {
	this.changeFormat( null, {
		tag: 'A'
	}, this.getSelection(), true );
	return this.focus();
};

proto.setFontFace = function ( name ) {
	let className = this._config.classNames.fontFamily;
	this.changeFormat( name ? {
		tag: 'SPAN',
		attributes: {
			'class': className,
			style: 'font-family: ' + name + ', sans-serif;'
		}
	} : null, {
		tag: 'SPAN',
		attributes: { 'class': className }
	});
	return this.focus();
};
proto.setFontSize = function ( size ) {
	let className = this._config.classNames.fontSize;
	this.changeFormat( size ? {
		tag: 'SPAN',
		attributes: {
			'class': className,
			style: 'font-size: ' +
				( typeof size === 'number' ? size + 'px' : size )
		}
	} : null, {
		tag: 'SPAN',
		attributes: { 'class': className }
	});
	return this.focus();
};

proto.setTextColour = function ( colour ) {
	let className = this._config.classNames.colour;
	this.changeFormat( colour ? {
		tag: 'SPAN',
		attributes: {
			'class': className,
			style: 'color:' + colour
		}
	} : null, {
		tag: 'SPAN',
		attributes: { 'class': className }
	});
	return this.focus();
};

proto.setHighlightColour = function ( colour ) {
	let className = this._config.classNames.highlight;
	this.changeFormat( colour ? {
		tag: 'SPAN',
		attributes: {
			'class': className,
			style: 'background-color:' + colour
		}
	} : colour, {
		tag: 'SPAN',
		attributes: { 'class': className }
	});
	return this.focus();
};

proto.setTextAlignment = function ( alignment ) {
	this.forEachBlock( function ( block ) {
		let className = block.className
			.split( /\s+/ )
			.filter( function ( klass ) {
				return !!klass && !/^align/.test( klass );
			})
			.join( ' ' );
		if ( alignment ) {
			block.className = className + ' align-' + alignment;
			block.style.textAlign = alignment;
		} else {
			block.className = className;
			block.style.textAlign = '';
		}
	}, true );
	return this.focus();
};

proto.setTextDirection = function ( direction ) {
	this.forEachBlock( function ( block ) {
		if ( direction ) {
			block.dir = direction;
		} else {
			block.removeAttribute( 'dir' );
		}
	}, true );
	return this.focus();
};

// ---

let addPre = function ( frag ) {
	let root = this._root;
	let output = doc.createDocumentFragment();
	let walker = getBlockWalker( frag, root );
	let node;
	// 1. Extract inline content; drop all blocks and contains.
	while (( node = walker.nextNode() )) {
		// 2. Replace <br> with \n in content
		let nodes = node.querySelectorAll( 'BR' );
		let brBreaksLine = [];
		let l = nodes.length;
		let i, br;

		// Must calculate whether the <br> breaks a line first, because if we
		// have two <br>s next to each other, after the first one is converted
		// to a block split, the second will be at the end of a block and
		// therefore seem to not be a line break. But in its original context it
		// was, so we should also convert it to a block split.
		for ( i = 0; i < l; ++i ) {
			brBreaksLine[i] = isLineBreak( nodes[i], false );
		}
		while ( l-- ) {
			br = nodes[l];
			if ( !brBreaksLine[l] ) {
				br.remove();
			} else {
				br.replaceWith( doc.createTextNode( '\n' ) );
			}
		}
		// 3. Remove <code>; its format clashes with <pre>
		nodes = node.querySelectorAll( 'CODE' );
		l = nodes.length;
		while ( l-- ) {
			nodes[l].remove();
		}
		if ( output.childNodes.length ) {
			output.append( doc.createTextNode( '\n' ) );
		}
		output.append( empty( node ) );
	}
	// 4. Replace nbsp with regular sp
	walker = doc.createTreeWalker( output, SHOW_TEXT );
	while (( node = walker.nextNode() )) {
		node.data = node.data.replace( NBSP, ' ' ); // nbsp -> sp
	}
	output.normalize();
	return fixCursor( this.createElement( 'PRE',
		this._config.tagAttributes.pre, [
			output
		]), root );
};

let removePre = function ( frag ) {
	let root = this._root;
	let pres = frag.querySelectorAll( 'PRE' );
	let l = pres.length;
	let pre, walker, node, value, contents, index;
	while ( l-- ) {
		pre = pres[l];
		walker = doc.createTreeWalker( pre, SHOW_TEXT );
		while (( node = walker.nextNode() )) {
			value = node.data;
			value = value.replace( / (?= )/g, NBSP ); // sp -> nbsp
			contents = doc.createDocumentFragment();
			while (( index = value.indexOf( '\n' ) ) > -1 ) {
				contents.append(
					doc.createTextNode( value.slice( 0, index ) )
				);
				contents.append( doc.createElement( 'BR' ) );
				value = value.slice( index + 1 );
			}
			node.before( contents );
			node.data = value;
		}
		fixContainer( pre, root );
		pre.replaceWith( empty( pre ) );
	}
	return frag;
};

proto.code = function () {
	let range = this.getSelection();
	if ( range.collapsed || isContainer( range.commonAncestorContainer ) ) {
		this.modifyBlocks( addPre, range );
	} else {
		this.changeFormat({
			tag: 'CODE',
			attributes: this._config.tagAttributes.code
		}, null, range );
	}
	return this.focus();
};

proto.removeCode = function () {
	let range = this.getSelection();
	let ancestor = range.commonAncestorContainer;
	let inPre = getClosest( ancestor, this._root, 'PRE' );
	if ( inPre ) {
		this.modifyBlocks( removePre, range );
	} else {
		this.changeFormat( null, { tag: 'CODE' }, range );
	}
	return this.focus();
};

proto.toggleCode = function () {
	if ( this.hasFormat( 'PRE' ) || this.hasFormat( 'CODE' ) ) {
		this.removeCode();
	} else {
		this.code();
	}
	return this;
};

// ---

function removeFormatting ( self, root, clean ) {
	let node, next;
	for ( node = root.firstChild; node; node = next ) {
		next = node.nextSibling;
		if ( isInline( node ) ) {
			if ( node.nodeType === TEXT_NODE || node.nodeName === 'BR' || node.nodeName === 'IMG' ) {
				clean.append( node );
				continue;
			}
		} else if ( isBlock( node ) ) {
			clean.append( self.createDefaultBlock([
				removeFormatting(
					self, node, doc.createDocumentFragment() )
			]));
			continue;
		}
		removeFormatting( self, node, clean );
	}
	return clean;
}

proto.removeAllFormatting = function ( range ) {
	if ( !range && !( range = this.getSelection() ) || range.collapsed ) {
		return this;
	}

	let root = this._root;
	let stopNode = range.commonAncestorContainer;
	while ( stopNode && !isBlock( stopNode ) ) {
		stopNode = stopNode.parentNode;
	}
	if ( !stopNode ) {
		expandRangeToBlockBoundaries( range, root );
		stopNode = root;
	}
	if ( stopNode.nodeType === TEXT_NODE ) {
		return this;
	}

	// Record undo point
	this.saveUndoState( range );

	// Avoid splitting where we're already at edges.
	moveRangeBoundariesUpTree( range, stopNode, stopNode, root );

	// Split the selection up to the block, or if whole selection in same
	// block, expand range boundaries to ends of block and split up to root.
	let startContainer = range.startContainer;
	let startOffset = range.startOffset;
	let endContainer = range.endContainer;
	let endOffset = range.endOffset;

	// Split end point first to avoid problems when end and start
	// in same container.
	let formattedNodes = doc.createDocumentFragment();
	let cleanNodes = doc.createDocumentFragment();
	let nodeAfterSplit = split( endContainer, endOffset, stopNode, root );
	let nodeInSplit = split( startContainer, startOffset, stopNode, root );
	let nextNode, childNodes;

	// Then replace contents in split with a cleaned version of the same:
	// blocks become default blocks, text and leaf nodes survive, everything
	// else is obliterated.
	while ( nodeInSplit !== nodeAfterSplit ) {
		nextNode = nodeInSplit.nextSibling;
		formattedNodes.append( nodeInSplit );
		nodeInSplit = nextNode;
	}
	removeFormatting( this, formattedNodes, cleanNodes );
	cleanNodes.normalize();
	nodeInSplit = cleanNodes.firstChild;
	nextNode = cleanNodes.lastChild;

	// Restore selection
	childNodes = stopNode.childNodes;
	if ( nodeInSplit ) {
		stopNode.insertBefore( cleanNodes, nodeAfterSplit );
		startOffset = indexOf( childNodes, nodeInSplit );
		endOffset = indexOf( childNodes, nextNode ) + 1;
	} else {
		startOffset = indexOf( childNodes, nodeAfterSplit );
		endOffset = startOffset;
	}

	// Merge text nodes at edges, if possible
	range.setStart( stopNode, startOffset );
	range.setEnd( stopNode, endOffset );
	mergeInlines( stopNode, range );

	// And move back down the tree
	moveRangeBoundariesDownTree( range );

	this.setSelection( range );
	this._updatePath( range, true );

	return this.focus();
};

proto.increaseQuoteLevel = command( 'modifyBlocks', increaseBlockQuoteLevel );
proto.decreaseQuoteLevel = command( 'modifyBlocks', decreaseBlockQuoteLevel );

proto.changeIndentationLevel = function (direction) {
	let parent = this.getSelectionClosest('UL,OL,BLOCKQUOTE');
	if (parent || 'increase' === direction) {
		let method = ( !parent || 'BLOCKQUOTE' === parent.nodeName ) ? 'Quote' : 'List';
		this[ direction + method + 'Level' ]();
	}
};

proto.makeUnorderedList = command( 'modifyBlocks', makeUnorderedList );
proto.makeOrderedList = command( 'modifyBlocks', makeOrderedList );
proto.removeList = command( 'modifyBlocks', removeList );

win.Squire = Squire;

})( document );

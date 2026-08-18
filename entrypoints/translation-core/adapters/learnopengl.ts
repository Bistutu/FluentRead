import {createDeclarativeAdapter} from './declarative';

/**
 * LearnOpenGL's legacy image-backed navigation uses fixed-height menu rows.
 * Appending bilingual block content makes neighbouring rows overlap and can
 * cover their click targets, so the site-owned navigation stays untouched.
 * The reading surface under #content remains eligible for normal discovery.
 */
export const learnOpenGLAdapter = createDeclarativeAdapter({
    id: 'learnopengl',
    priority: 300,
    hosts: [{hostname: 'learnopengl.com', includeSubdomains: true}],
    prune: [
        {
            selector: '#nav',
            reason: 'learnopengl-fixed-navigation',
        },
    ],
});

export default learnOpenGLAdapter;

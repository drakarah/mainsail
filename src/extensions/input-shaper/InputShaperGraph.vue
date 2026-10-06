<template>
    <div class="input-shaper-graph">
        <div v-if="label" class="text-caption text--secondary mb-1">{{ label }}</div>
        <v-img
            v-if="src"
            :src="src"
            :height="height"
            contain
            class="input-shaper-graph__image rounded"
            @click="zoom = true">
            <template #placeholder>
                <div class="fill-height d-flex align-center justify-center">
                    <v-progress-circular indeterminate size="24" width="2" />
                </div>
            </template>
        </v-img>
        <div
            v-else
            :style="{ height: `${height}px` }"
            class="input-shaper-graph__missing rounded d-flex align-center justify-center text-caption text--secondary px-3 text-center">
            {{ $t('InputShaper.GraphDeleted') }}
        </div>
        <v-dialog v-if="src" v-model="zoom" max-width="1400">
            <v-card>
                <v-toolbar flat dense>
                    <v-toolbar-title class="text-subtitle-1">{{ label }}</v-toolbar-title>
                    <v-spacer />
                    <v-btn icon :href="src" target="_blank">
                        <v-icon>{{ mdiOpenInNew }}</v-icon>
                    </v-btn>
                    <v-btn icon @click="zoom = false">
                        <v-icon>{{ mdiCloseThick }}</v-icon>
                    </v-btn>
                </v-toolbar>
                <img :src="src" :alt="label" class="input-shaper-graph__full" @click="zoom = false" />
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator'
import { mdiCloseThick, mdiOpenInNew } from '@mdi/js'

@Component
export default class InputShaperGraph extends Vue {
    mdiCloseThick = mdiCloseThick
    mdiOpenInNew = mdiOpenInNew

    @Prop({ type: String, default: null }) declare readonly src: string | null
    @Prop({ type: String, default: '' }) declare readonly label: string
    @Prop({ type: Number, default: 140 }) declare readonly height: number

    zoom = false
}
</script>

<style scoped>
.input-shaper-graph__image {
    cursor: zoom-in;
    background: #fff;
}

.input-shaper-graph__missing {
    border: 1px dashed rgba(128, 128, 128, 0.5);
}

.input-shaper-graph__full {
    display: block;
    width: 100%;
    height: auto;
    cursor: zoom-out;
}
</style>
